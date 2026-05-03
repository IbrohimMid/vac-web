import { describe, expect, it } from 'vitest';

import { affordanceFor, listAffordances } from './affordanceCatalog';

describe('affordanceFor', () => {
	it('returns hidden for unknown IDs', () => {
		const d = affordanceFor('does.not.exist', {
			commandStatus: 'unknown',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.visible).toBe(false);
		expect(d.enabled).toBe(false);
	});

	it('hides Topbar model select when sessionKind is not acp', () => {
		const d = affordanceFor('topbar.model.select', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			sessionKind: 'codex',
			metadataKeys: ['modes'],
		});
		expect(d.visible).toBe(false);
	});

	it('enables Topbar model select for acp+modes', () => {
		const d = affordanceFor('topbar.model.select', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			sessionKind: 'acp',
			metadataKeys: ['modes'],
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('session.mode.set');
	});

	it('disables release deploy when backend is not wired (acceptance #1)', () => {
		const d = affordanceFor('release.deploy.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: false,
			gateReady: true,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/not wired/i);
	});

	it('disables release deploy when gates are not ready', () => {
		const d = affordanceFor('release.deploy.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: false,
			gateReady: false,
		});
		expect(d.enabled).toBe(false);
	});

	it('enables overlay.dismiss_all as frontend_owned with no command (acceptance #1)', () => {
		const d = affordanceFor('overlay.dismiss_all', {
			commandStatus: 'frontend_owned',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBeNull();
	});

	it('every catalog entry has a disabled-copy string (acceptance #2)', () => {
		for (const spec of listAffordances()) {
			expect(typeof spec.disabledCopy).toBe('string');
			expect(spec.disabledCopy.length).toBeGreaterThan(0);
		}
	});

	it('enables session.create when backend is implemented', () => {
		const d = affordanceFor('session.create', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('session.create');
	});

	it('disables session.create when backend is not_wired', () => {
		const d = affordanceFor('session.create', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/not wired/i);
	});

	it('enables notify.dismiss as frontend_owned', () => {
		const d = affordanceFor('notify.dismiss', {
			commandStatus: 'frontend_owned',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBeNull();
	});

	it('enables transcript.tool.toggle as frontend_owned', () => {
		const d = affordanceFor('transcript.tool.toggle', {
			commandStatus: 'frontend_owned',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(true);
	});

	it('enables topbar.search.trigger as frontend_owned', () => {
		const d = affordanceFor('topbar.search.trigger', {
			commandStatus: 'frontend_owned',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(true);
	});

	it('hides composer.message.submit when there is no session', () => {
		const d = affordanceFor('composer.message.submit', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.visible).toBe(false);
	});

	it('enables composer.message.submit when transport + session are present', () => {
		const d = affordanceFor('composer.message.submit', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('message.submit');
	});

	it('disables composer.message.submit when message.submit is not_wired', () => {
		const d = affordanceFor('composer.message.submit', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toBeDefined();
	});

	it('hides approvals.approve_all when transport is missing', () => {
		const d = affordanceFor('approvals.approve_all', {
			commandStatus: 'frontend_owned',
			hasTransport: false,
			hasSessionId: false,
		});
		expect(d.visible).toBe(false);
	});

	it('enables approvals.approve_all when transport is present', () => {
		const d = affordanceFor('approvals.approve_all', {
			commandStatus: 'frontend_owned',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBeNull();
	});

	it('enables approvals.decide and exposes approval.respond command', () => {
		const d = affordanceFor('approvals.decide', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('approval.respond');
	});

	it('disables approvals.decide when approval.respond is not_wired', () => {
		const d = affordanceFor('approvals.decide', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
	});

	it('hides review.revert_all when there is no session yet', () => {
		const d = affordanceFor('review.revert_all', {
			commandStatus: 'frontend_owned',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.visible).toBe(false);
	});

	it('enables review.revert_all when transport + session are present', () => {
		const d = affordanceFor('review.revert_all', {
			commandStatus: 'frontend_owned',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBeNull();
	});
});
