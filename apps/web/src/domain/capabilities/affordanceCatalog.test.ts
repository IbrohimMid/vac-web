import { describe, expect, it } from 'vitest';

import { commandStatus } from '../../generated/commandCatalog';
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

	it('disables release deploy when gates are not ready', () => {
		const d = affordanceFor('release.deploy.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			gateReady: false,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/gate/i);
	});

	it('enables release deploy when backend is implemented and gates are ready', () => {
		const d = affordanceFor('release.deploy.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			gateReady: true,
		});
		expect(d.visible).toBe(true);
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('release.deploy');
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

	it('every backend command in the affordance catalog exists in the generated command catalog', () => {
		for (const spec of listAffordances()) {
			if (spec.command == null) continue;
			expect(commandStatus(spec.command), spec.id).toBeDefined();
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

	it('enables approvals.approve and exposes approval.approve command', () => {
		const d = affordanceFor('approvals.approve', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('approval.approve');
	});

	it('enables approvals.reject and exposes approval.reject command', () => {
		const d = affordanceFor('approvals.reject', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('approval.reject');
	});

	it('disables approval decision affordances when the bridge command is not_wired', () => {
		for (const id of ['approvals.approve', 'approvals.reject']) {
			const d = affordanceFor(id, {
				commandStatus: 'not_wired',
				hasTransport: true,
				hasSessionId: true,
			});
			expect(d.enabled).toBe(false);
		}
	});

	// Release-plane closeout 2026-05-10: the command surface is now wired.
	// These pairs assert readiness-gated disablement where relevant and the
	// implemented -> enabled positive path.

	it('disables release.publish.button when gates are not ready', () => {
		const d = affordanceFor('release.publish.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			gateReady: false,
		});
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/gate/i);
	});

	it('enables release.publish.button when implemented and gate ready', () => {
		const d = affordanceFor('release.publish.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
			gateReady: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('release.publish');
	});

	it('disables release.generate_notes.button when not_wired', () => {
		const d = affordanceFor('release.generate_notes.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
	});

	it('enables release.generate_notes.button when implemented', () => {
		const d = affordanceFor('release.generate_notes.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
		expect(d.command).toBe('release.generate_notes');
	});

	it('disables gate.signoff.button when not_wired', () => {
		const d = affordanceFor('gate.signoff.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/audit/i);
	});

	it('enables gate.signoff.button when implemented', () => {
		const d = affordanceFor('gate.signoff.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
	});

	it('disables gate.override.button when not_wired', () => {
		const d = affordanceFor('gate.override.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/reason/i);
	});

	it('enables gate.override.button when implemented', () => {
		const d = affordanceFor('gate.override.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
	});

	it('disables runtime.cancel_job.button when not_wired', () => {
		const d = affordanceFor('runtime.cancel_job.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
	});

	it('enables runtime.cancel_job.button when implemented', () => {
		const d = affordanceFor('runtime.cancel_job.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
	});

	it('disables migration.create_draft.button when not_wired', () => {
		const d = affordanceFor('migration.create_draft.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(false);
		expect(d.disabledReason).toMatch(/Phase 7/i);
	});

	it('enables migration.create_draft.button when implemented', () => {
		const d = affordanceFor('migration.create_draft.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: true,
		});
		expect(d.enabled).toBe(true);
	});

	it('disables connector.connect.button when not_wired', () => {
		const d = affordanceFor('connector.connect.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(false);
	});

	it('enables connector.connect.button when implemented and transport present', () => {
		const d = affordanceFor('connector.connect.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(true);
	});

	it('disables connector.disconnect.button when not_wired', () => {
		const d = affordanceFor('connector.disconnect.button', {
			commandStatus: 'not_wired',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(false);
	});

	it('enables connector.disconnect.button when implemented', () => {
		const d = affordanceFor('connector.disconnect.button', {
			commandStatus: 'implemented',
			hasTransport: true,
			hasSessionId: false,
		});
		expect(d.enabled).toBe(true);
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
