import { describe, expect, it } from 'vitest';

import {
	evaluateFreeze,
	listRenderingPipelineModes,
	nextMode,
	pipelineModeFor,
} from './transcriptFreeze';

describe('evaluateFreeze', () => {
	it('accepts live-stream events for a live session', () => {
		const d = evaluateFreeze(
			{ sessionId: 's1', mode: 'live' },
			{ sessionId: 's1', origin: 'live_stream' },
		);
		expect(d.accepted).toBe(true);
		expect(d.mode).toBe('live');
	});

	it('rejects edits with mismatched session ids', () => {
		const d = evaluateFreeze(
			{ sessionId: 's1', mode: 'live' },
			{ sessionId: 's2', origin: 'live_stream' },
		);
		expect(d.accepted).toBe(false);
		expect(d.reason).toBe('mode_override');
	});

	it('rejects all edits on a frozen session (freeze-after-close rule)', () => {
		const d = evaluateFreeze(
			{ sessionId: 's1', mode: 'frozen', closedAt: '2026-05-02T12:00:00Z' },
			{ sessionId: 's1', origin: 'live_stream' },
		);
		expect(d.accepted).toBe(false);
		expect(d.reason).toBe('session_closed');
		expect(d.detail).toContain('2026-05-02T12:00:00Z');
	});

	it('rejects archived sessions even if mode is live', () => {
		const d = evaluateFreeze(
			{ sessionId: 's1', mode: 'live', archived: true },
			{ sessionId: 's1', origin: 'live_stream' },
		);
		expect(d.accepted).toBe(false);
		expect(d.reason).toBe('session_archived');
	});

	it('rejects replay events on a live session', () => {
		const d = evaluateFreeze(
			{ sessionId: 's1', mode: 'live' },
			{ sessionId: 's1', origin: 'replay' },
		);
		expect(d.accepted).toBe(false);
		expect(d.reason).toBe('mode_override');
	});

	it('accepts only replay events while replaying', () => {
		const replay = evaluateFreeze(
			{ sessionId: 's1', mode: 'replay' },
			{ sessionId: 's1', origin: 'replay' },
		);
		expect(replay.accepted).toBe(true);
		expect(replay.mode).toBe('replay');

		const live = evaluateFreeze(
			{ sessionId: 's1', mode: 'replay' },
			{ sessionId: 's1', origin: 'live_stream' },
		);
		expect(live.accepted).toBe(false);
		expect(live.reason).toBe('session_replay');
	});
});

describe('nextMode', () => {
	it('opens a session into live mode', () => {
		expect(nextMode('frozen', { type: 'session.opened' })).toBe('live');
	});

	it('transitions to replay when reconstruction starts', () => {
		expect(nextMode('live', { type: 'session.replay.started' })).toBe('replay');
	});

	it('freezes after replay finishes', () => {
		expect(nextMode('replay', { type: 'session.replay.finished' })).toBe('frozen');
	});

	it('freezes on close and archive', () => {
		expect(nextMode('live', { type: 'session.closed' })).toBe('frozen');
		expect(nextMode('live', { type: 'session.archived' })).toBe('frozen');
	});
});

describe('rendering pipeline catalog', () => {
	it('exposes one entry per transcript mode', () => {
		const modes = listRenderingPipelineModes().map((m) => m.mode).sort();
		expect(modes).toEqual(['frozen', 'live', 'replay']);
	});

	it('frozen mode caches rendered HTML and is immutable', () => {
		const frozen = pipelineModeFor('frozen');
		expect(frozen.mutable).toBe(false);
		expect(frozen.cacheRenderedHtml).toBe(true);
	});

	it('live mode is mutable and does not cache HTML', () => {
		const live = pipelineModeFor('live');
		expect(live.mutable).toBe(true);
		expect(live.cacheRenderedHtml).toBe(false);
	});

	it('every entry has a non-empty description', () => {
		for (const m of listRenderingPipelineModes()) {
			expect(m.description.length).toBeGreaterThan(0);
		}
	});
});
