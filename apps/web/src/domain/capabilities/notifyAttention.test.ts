import { describe, expect, it } from 'vitest';

import { attentionLevelFor } from './notifyAttention';

describe('attentionLevelFor', () => {
	it('keeps not-wired copy out of the sticky lane (acceptance #3)', () => {
		expect(attentionLevelFor('feature.not_wired').level).toBe('inline');
	});

	it('routes profile denials to sticky', () => {
		expect(attentionLevelFor('profile.tool_denied').level).toBe('sticky');
	});

	it('routes audit write failures to sticky', () => {
		expect(attentionLevelFor('audit.write_failed').level).toBe('sticky');
	});

	it('routes auth errors to overlay', () => {
		expect(attentionLevelFor('auth.required').level).toBe('overlay');
		expect(attentionLevelFor('auth.invalid_token').level).toBe('overlay');
	});

	it('keeps session lifecycle events silent', () => {
		expect(attentionLevelFor('session.resumed').level).toBe('silent');
		expect(attentionLevelFor('session.renamed').level).toBe('silent');
	});

	it('routes handoff and approval events to inline by default', () => {
		expect(attentionLevelFor('handoff.created').level).toBe('inline');
		expect(attentionLevelFor('approval.expired').level).toBe('inline');
	});

	it('routes wire errors to inline (transient)', () => {
		expect(attentionLevelFor('protocol.bad_envelope').level).toBe('inline');
		expect(attentionLevelFor('rpc.unknown_method').level).toBe('inline');
	});

	it('falls back to inline for unknown codes', () => {
		expect(attentionLevelFor('totally.unknown').level).toBe('inline');
	});
});
