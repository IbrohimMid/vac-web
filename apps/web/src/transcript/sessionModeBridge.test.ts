import { afterEach, describe, expect, it } from 'vitest';
import { useTranscript } from '../stores/transcript';
import { applyLifecycleEvent } from './modeWiring';
import {
	TRANSCRIPT_MODE_FRAME_MAP,
	attachTranscriptModeBridge,
	type TranscriptModeTransport,
} from './sessionModeBridge';

type FrameLite = { readonly type: string; readonly payload: unknown };
type FrameHandler = (ev: FrameLite) => void;

function makeFakeTransport(): {
	on: TranscriptModeTransport['on'];
	emit: (type: string, payload?: unknown) => void;
	listeners: () => ReadonlyMap<string, ReadonlyArray<FrameHandler>>;
} {
	const listeners = new Map<string, FrameHandler[]>();
	const on: TranscriptModeTransport['on'] = (type, handler) => {
		const arr = listeners.get(type) ?? [];
		arr.push(handler);
		listeners.set(type, arr);
		return () => {
			const current = listeners.get(type) ?? [];
			const next = current.filter((h) => h !== handler);
			if (next.length === 0) listeners.delete(type);
			else listeners.set(type, next);
		};
	};
	const emit = (type: string, payload: unknown = {}): void => {
		const frame: FrameLite = { type, payload };
		for (const h of listeners.get(type) ?? []) h(frame);
	};
	return { on, emit, listeners: () => listeners };
}

afterEach(() => {
	useTranscript.getState().setMode('live');
});

describe('sessionModeBridge', () => {
	it('frame map covers exactly the four wire frames the bridge listens to', () => {
		expect(Object.keys(TRANSCRIPT_MODE_FRAME_MAP).sort()).toEqual([
			'session.closed',
			'session.ready',
			'session.resume.started',
			'session.resumed',
		]);
	});

	it('session.ready dispatches session.opened and resets mode to live', () => {
		const t = makeFakeTransport();
		useTranscript.getState().setMode('frozen');
		const detach = attachTranscriptModeBridge({ on: t.on });
		t.emit('session.ready');
		expect(useTranscript.getState().mode).toBe('live');
		detach();
	});

	it('session.resume.started moves live -> replay', () => {
		const t = makeFakeTransport();
		useTranscript.getState().setMode('live');
		const detach = attachTranscriptModeBridge({ on: t.on });
		t.emit('session.resume.started');
		expect(useTranscript.getState().mode).toBe('replay');
		detach();
	});

	it('session.resumed dispatches session.opened (live)', () => {
		const t = makeFakeTransport();
		useTranscript.getState().setMode('replay');
		const detach = attachTranscriptModeBridge({ on: t.on });
		t.emit('session.resumed');
		expect(useTranscript.getState().mode).toBe('live');
		detach();
	});

	it('session.closed freezes the transcript', () => {
		const t = makeFakeTransport();
		useTranscript.getState().setMode('live');
		const detach = attachTranscriptModeBridge({ on: t.on });
		t.emit('session.closed');
		expect(useTranscript.getState().mode).toBe('frozen');
		detach();
	});

	it('onDispatch is called with frame type + lifecycle event', () => {
		const t = makeFakeTransport();
		const calls: Array<[string, string]> = [];
		const detach = attachTranscriptModeBridge(
			{ on: t.on },
			{ onDispatch: (frame, event) => calls.push([frame, event]) },
		);
		t.emit('session.ready');
		t.emit('session.resume.started');
		t.emit('session.resumed');
		t.emit('session.closed');
		expect(calls).toEqual([
			['session.ready', 'session.opened'],
			['session.resume.started', 'session.replay.started'],
			['session.resumed', 'session.opened'],
			['session.closed', 'session.closed'],
		]);
		detach();
	});

	it('detach removes every handler the bridge registered', () => {
		const t = makeFakeTransport();
		const detach = attachTranscriptModeBridge({ on: t.on });
		expect(t.listeners().size).toBe(4);
		detach();
		expect(t.listeners().size).toBe(0);
	});

	it('multiple bridge instances coexist and only their own handlers are detached', () => {
		const t = makeFakeTransport();
		const detachA = attachTranscriptModeBridge({ on: t.on });
		const detachB = attachTranscriptModeBridge({ on: t.on });
		let counts = 0;
		for (const arr of t.listeners().values()) counts += arr.length;
		expect(counts).toBe(8);
		detachA();
		counts = 0;
		for (const arr of t.listeners().values()) counts += arr.length;
		expect(counts).toBe(4);
		detachB();
	});

	it('integrates with applyLifecycleEvent (smoke)', () => {
		// Sanity: the helper composes the same way modeWiring is tested.
		useTranscript.getState().setMode('live');
		expect(applyLifecycleEvent('session.replay.started')).toBe('replay');
		expect(applyLifecycleEvent('session.replay.finished')).toBe('frozen');
	});
});
