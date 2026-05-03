import { describe, expect, it } from 'vitest';
import {
	SESSION_LIFECYCLE_EVENTS,
	SESSION_LIFECYCLE_FALLBACK,
	isSessionLifecycleEvent,
	sessionLifecycleCopyFor,
} from './sessionLifecycle';

describe('session lifecycle UX mapping (slice 09)', () => {
	it('catalogs every session.* event the bridge emits', () => {
		// Mirrors translator/mod.rs:
		for (const code of [
			'session.resume.initializing',
			'session.resume.started',
			'session.resume.warning',
			'session.resume.failed',
			'session.resumed',
			'session.closed',
			'session.history.listed',
			'session.history.forgotten',
			'session.renamed',
		]) {
			expect(SESSION_LIFECYCLE_EVENTS).toContain(code);
			const copy = sessionLifecycleCopyFor(code);
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.detail.length).toBeGreaterThan(0);
		}
	});

	it('distinguishes close from forget (forget is destructive + notifies)', () => {
		const closed = sessionLifecycleCopyFor('session.closed');
		const forgotten = sessionLifecycleCopyFor('session.history.forgotten');
		expect(closed.title).not.toBe(forgotten.title);
		expect(forgotten.notify).toBe(true);
		expect(closed.notify).toBe(false);
		expect(closed.detail).toContain('history');
		expect(forgotten.detail).toContain('permanent');
	});

	it('resume.initializing/started keep the session non-usable until resumed', () => {
		expect(sessionLifecycleCopyFor('session.resume.initializing').sessionUsable).toBe(false);
		expect(sessionLifecycleCopyFor('session.resume.started').sessionUsable).toBe(false);
		expect(sessionLifecycleCopyFor('session.resumed').sessionUsable).toBe(true);
	});

	it('resume.warning keeps session usable but notifies', () => {
		const warn = sessionLifecycleCopyFor('session.resume.warning');
		expect(warn.sessionUsable).toBe(true);
		expect(warn.notify).toBe(true);
	});

	it('resume.failed marks session unusable and notifies', () => {
		const fail = sessionLifecycleCopyFor('session.resume.failed');
		expect(fail.sessionUsable).toBe(false);
		expect(fail.notify).toBe(true);
	});

	it('falls back gracefully for unknown codes', () => {
		expect(sessionLifecycleCopyFor('session.brand_new')).toEqual(SESSION_LIFECYCLE_FALLBACK);
	});

	it('isSessionLifecycleEvent only matches session.* codes', () => {
		expect(isSessionLifecycleEvent('session.closed')).toBe(true);
		expect(isSessionLifecycleEvent('handoff.created')).toBe(false);
	});
});
