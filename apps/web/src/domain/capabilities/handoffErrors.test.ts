import { describe, expect, it } from 'vitest';
import {
	HANDOFF_EVENT_CODES,
	HANDOFF_ERROR_FALLBACK,
	handoffErrorCopyFor,
	isHandoffEvent,
	shouldStickyNotify,
} from './handoffErrors';

describe('handoff error UX mapping (slice 07)', () => {
	it('covers every bridge-emitted handoff event code', () => {
		// Mirrors translator/mod.rs and handoff/mod.rs.
		for (const code of [
			'handoff.created',
			'handoff.approved',
			'handoff.rejected',
			'handoff.invalid_state',
			'handoff.approve_failed',
			'handoff.reject_failed',
			'handoff.dispatch_rejected',
			'handoff.dispatch_state_error',
			'handoff.execution_bind_failed',
			'handoff.execution_failed',
			'handoff.duplicate_signer',
		]) {
			expect(HANDOFF_EVENT_CODES).toContain(code);
			const copy = handoffErrorCopyFor(code);
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.detail.length).toBeGreaterThan(0);
		}
	});

	it('success codes are not sticky notifications', () => {
		expect(shouldStickyNotify('handoff.created')).toBe(false);
		expect(shouldStickyNotify('handoff.approved')).toBe(false);
	});

	it('operator-actionable failures are sticky notifications', () => {
		expect(shouldStickyNotify('handoff.approve_failed')).toBe(true);
		expect(shouldStickyNotify('handoff.dispatch_rejected')).toBe(true);
		expect(shouldStickyNotify('handoff.execution_failed')).toBe(true);
	});

	it('classifies actions distinctly so UX can branch', () => {
		expect(handoffErrorCopyFor('handoff.approve_failed').actionClass).toBe('reapprove');
		expect(handoffErrorCopyFor('handoff.rejected').actionClass).toBe('recreate');
		expect(handoffErrorCopyFor('handoff.dispatch_rejected').actionClass).toBe('fix_pin');
		expect(handoffErrorCopyFor('handoff.dispatch_state_error').actionClass).toBe('wait');
		expect(handoffErrorCopyFor('handoff.execution_failed').actionClass).toBe('inspect');
	});

	it('falls back gracefully for unknown codes', () => {
		expect(handoffErrorCopyFor('handoff.brand_new')).toEqual(HANDOFF_ERROR_FALLBACK);
	});

	it('isHandoffEvent only matches handoff.* codes', () => {
		expect(isHandoffEvent('handoff.execution_failed')).toBe(true);
		expect(isHandoffEvent('approval.not_found')).toBe(false);
	});
});
