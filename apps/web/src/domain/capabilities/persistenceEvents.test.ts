import { describe, expect, it } from 'vitest';

import {
	persistenceEventCopyFor,
	isPersistenceEvent,
	isPersistenceDegraded,
	replayBadgeFor,
	PERSISTENCE_EVENT_CODES,
	PERSISTENCE_EVENT_FALLBACK,
} from './persistenceEvents';

describe('persistenceEventCopyFor', () => {
	it('marks degraded as degraded+sticky and recovered as the inverse', () => {
		const d = persistenceEventCopyFor('session.persistence_degraded');
		const r = persistenceEventCopyFor('session.persistence_recovered');
		expect(d.degraded).toBe(true);
		expect(d.sticky).toBe(true);
		expect(r.degraded).toBe(false);
		expect(r.sticky).toBe(false);
		expect(isPersistenceDegraded('session.persistence_degraded')).toBe(true);
		expect(isPersistenceDegraded('session.persistence_recovered')).toBe(false);
	});

	it('isPersistenceEvent recognises only known codes', () => {
		for (const code of PERSISTENCE_EVENT_CODES) {
			expect(isPersistenceEvent(code)).toBe(true);
		}
		expect(isPersistenceEvent('session.unknown')).toBe(false);
	});

	it('every code returns non-empty title and detail', () => {
		for (const code of PERSISTENCE_EVENT_CODES) {
			const c = persistenceEventCopyFor(code);
			expect(c.title.length).toBeGreaterThan(0);
			expect(c.detail.length).toBeGreaterThan(0);
		}
	});

	it('falls back deterministically for unknown codes', () => {
		expect(persistenceEventCopyFor('session.totally.unknown')).toEqual(PERSISTENCE_EVENT_FALLBACK);
	});
});

describe('replayBadgeFor', () => {
	it('returns a replay badge for historical rows', () => {
		const b = replayBadgeFor({ isReplay: true });
		expect(b.badge).toBe('replay');
		expect(b.isHistorical).toBe(true);
		expect(b.tooltip).toMatch(/replay|history/i);
	});

	it('returns a live badge for live rows', () => {
		const b = replayBadgeFor({ isReplay: false });
		expect(b.badge).toBe('live');
		expect(b.isHistorical).toBe(false);
	});

	it('replay vs live badges differ — acceptance: cannot be mistaken for live', () => {
		const replay = replayBadgeFor({ isReplay: true });
		const live = replayBadgeFor({ isReplay: false });
		expect(replay.badge).not.toBe(live.badge);
		expect(replay.isHistorical).not.toBe(live.isHistorical);
	});
});
