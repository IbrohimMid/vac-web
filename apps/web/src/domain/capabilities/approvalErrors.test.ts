import { describe, expect, it } from 'vitest';
import {
	APPROVAL_ERROR_CODES,
	APPROVAL_ERROR_FALLBACK,
	approvalErrorCopyFor,
	isApprovalError,
} from './approvalErrors';

describe('approval error UX mapping (slice 06)', () => {
	it('covers every bridge-emitted approval error code', () => {
		// Mirrors translator/mod.rs (search for `approval.` codes).
		for (const code of [
			'approval.not_found',
			'approval.not_acp',
			'approval.option_not_found',
			'approval.option_kind_mismatch',
			'approval.option_forbidden',
			'approval.expired',
		]) {
			expect(APPROVAL_ERROR_CODES).toContain(code);
			const copy = approvalErrorCopyFor(code);
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.detail.length).toBeGreaterThan(0);
		}
	});

	it('expired approvals are surfaced as retryable but distinct from option_not_found', () => {
		const expired = approvalErrorCopyFor('approval.expired');
		expect(expired.retryable).toBe(true);
		expect(expired.title).not.toBe(approvalErrorCopyFor('approval.option_not_found').title);
	});

	it('forbidden options are non-retryable (need profile change)', () => {
		expect(approvalErrorCopyFor('approval.option_forbidden').retryable).toBe(false);
	});

	it('falls back gracefully for unknown codes', () => {
		expect(approvalErrorCopyFor('approval.something_new')).toEqual(APPROVAL_ERROR_FALLBACK);
	});

	it('isApprovalError only matches approval.* codes', () => {
		expect(isApprovalError('approval.not_found')).toBe(true);
		expect(isApprovalError('handoff.invalid_state')).toBe(false);
		expect(isApprovalError('feature.not_wired')).toBe(false);
	});
});
