import { describe, expect, it } from 'vitest';
import {
	affordanceFor,
	canExecute,
	disabledReasonFor,
	statusOf,
} from './affordance';

describe('affordanceFor', () => {
	it('treats implemented commands as enabled with no disabled reason', () => {
		const a = affordanceFor('session.create');
		expect(a.known).toBe(true);
		expect(a.status).toBe('implemented');
		expect(a.enabled).toBe(true);
		expect(a.notWired).toBe(false);
		expect(a.disabledReason).toBe('');
	});

	it('treats not_wired commands as disabled and exposes catalog reason copy', () => {
		const a = affordanceFor('release.deploy');
		expect(a.known).toBe(true);
		expect(a.status).toBe('not_wired');
		expect(a.enabled).toBe(false);
		expect(a.notWired).toBe(true);
		expect(a.disabledReason).toMatch(/disabled until|not wired|not implemented/i);
	});

	it('treats frontend_owned commands as enabled', () => {
		const a = affordanceFor('overlay.open');
		expect(a.status).toBe('frontend_owned');
		expect(a.enabled).toBe(true);
	});

	it('rejects unknown command ids without crashing', () => {
		const a = affordanceFor('does.not.exist');
		expect(a.known).toBe(false);
		expect(a.enabled).toBe(false);
		expect(a.disabledReason).toMatch(/not in the catalog/);
	});
});

describe('canExecute / statusOf / disabledReasonFor', () => {
	it('canExecute is true only for implemented commands', () => {
		expect(canExecute('session.create')).toBe(true);
		expect(canExecute('release.deploy')).toBe(false);
		expect(canExecute('overlay.open')).toBe(false); // frontend_owned, not bridge-executable
		expect(canExecute('does.not.exist')).toBe(false);
	});

	it('statusOf returns the catalog status', () => {
		expect(statusOf('session.create')).toBe('implemented');
		expect(statusOf('release.deploy')).toBe('not_wired');
		expect(statusOf('overlay.open')).toBe('frontend_owned');
		expect(statusOf('transcript.completed')).toBe('protocol_only');
	});

	it('disabledReasonFor returns empty string for executable commands', () => {
		expect(disabledReasonFor('session.create')).toBe('');
	});
});
