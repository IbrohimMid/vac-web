import { describe, expect, it } from 'vitest';

import {
	configLifecycleCopyFor,
	isConfigLifecycleEvent,
	CONFIG_LIFECYCLE_EVENTS,
	CONFIG_LIFECYCLE_FALLBACK,
} from './configLifecycle';

describe('configLifecycleCopyFor', () => {
	it('distinguishes validation failure from reload failure', () => {
		const v = configLifecycleCopyFor('config.validate.failed');
		const r = configLifecycleCopyFor('config.reload_failed');
		expect(v.phase).toBe('validate_failed');
		expect(r.phase).toBe('reload_failed');
		expect(v.title).not.toBe(r.title);
	});

	it('marks reloaded events as needing capability cache refresh', () => {
		expect(configLifecycleCopyFor('config.reloaded').refreshCaches).toBe(true);
		expect(configLifecycleCopyFor('config.validated').refreshCaches).toBe(false);
		expect(configLifecycleCopyFor('config.reload.started').refreshCaches).toBe(false);
	});

	it('preserves config_usable=true even on failure (live snapshot unchanged)', () => {
		for (const code of CONFIG_LIFECYCLE_EVENTS) {
			expect(configLifecycleCopyFor(code).configUsable).toBe(true);
		}
	});

	it('emits notify on terminal events but not on transient ones', () => {
		expect(configLifecycleCopyFor('config.reload.started').notify).toBe(false);
		expect(configLifecycleCopyFor('config.validated').notify).toBe(false);
		expect(configLifecycleCopyFor('config.reloaded').notify).toBe(true);
		expect(configLifecycleCopyFor('config.validate.failed').notify).toBe(true);
		expect(configLifecycleCopyFor('config.reload_failed').notify).toBe(true);
	});

	it('falls back deterministically for unknown event types', () => {
		const c = configLifecycleCopyFor('config.totally.unknown');
		expect(c).toEqual(CONFIG_LIFECYCLE_FALLBACK);
		expect(isConfigLifecycleEvent('config.totally.unknown')).toBe(false);
		expect(isConfigLifecycleEvent('config.reloaded')).toBe(true);
	});

	it('every code returns non-empty title and detail', () => {
		for (const code of CONFIG_LIFECYCLE_EVENTS) {
			const c = configLifecycleCopyFor(code);
			expect(c.title.length).toBeGreaterThan(0);
			expect(c.detail.length).toBeGreaterThan(0);
		}
	});
});
