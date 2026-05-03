import { describe, expect, it } from 'vitest';

import { gateAffordanceFor, validateOverrideRequest } from './gateState';

const capsBoth = { persistenceWired: true, auditWired: true } as const;

describe('gateAffordanceFor', () => {
	it('disables signoff when persistence is not wired', () => {
		const a = gateAffordanceFor(
			{ id: 'g1', outcome: 'fail' },
			{ persistenceWired: false, auditWired: true },
		);
		expect(a.canSignoff).toBe(false);
		expect(a.canOverride).toBe(false);
		expect(a.disabledReason).toMatch(/persistence/i);
	});

	it('disables override when audit is not wired', () => {
		const a = gateAffordanceFor(
			{ id: 'g1', outcome: 'fail' },
			{ persistenceWired: true, auditWired: false },
		);
		expect(a.canOverride).toBe(false);
		expect(a.disabledReason).toMatch(/audit/i);
	});

	it('allows signoff on non-pass and override on fail with no current override', () => {
		const a = gateAffordanceFor({ id: 'g1', outcome: 'fail' }, capsBoth);
		expect(a.canSignoff).toBe(true);
		expect(a.canOverride).toBe(true);
	});

	it('marks override active when expiresAt is in the future', () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		const a = gateAffordanceFor(
			{ id: 'g1', outcome: 'fail', override: { reason: 'pin missing', expiresAt: future } },
			capsBoth,
		);
		expect(a.overrideActive).toBe(true);
		expect(a.overrideExpired).toBe(false);
	});

	it('marks override expired and re-enables override when expiresAt is in the past', () => {
		const past = new Date(Date.now() - 60_000).toISOString();
		const a = gateAffordanceFor(
			{ id: 'g1', outcome: 'fail', override: { reason: 'old', expiresAt: past } },
			capsBoth,
		);
		expect(a.overrideActive).toBe(false);
		expect(a.overrideExpired).toBe(true);
		expect(a.canOverride).toBe(true);
	});
});

describe('validateOverrideRequest', () => {
	it('rejects missing reason', () => {
		const r = validateOverrideRequest({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe('gate.reason_required');
	});

	it('rejects missing or unparseable expiry', () => {
		const r1 = validateOverrideRequest({ reason: 'why' });
		expect(r1.ok).toBe(false);
		if (!r1.ok) expect(r1.code).toBe('gate.expiry_required');

		const r2 = validateOverrideRequest({ reason: 'why', expiresAt: 'not-a-date' });
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.code).toBe('gate.expiry_required');
	});

	it('rejects expiry in the past', () => {
		const r = validateOverrideRequest({ reason: 'why', expiresAt: new Date(Date.now() - 1000).toISOString() });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe('gate.expiry_in_past');
	});

	it('accepts a reason + future expiry', () => {
		const r = validateOverrideRequest({ reason: 'why', expiresAt: new Date(Date.now() + 60_000).toISOString() });
		expect(r.ok).toBe(true);
	});
});
