// Unified error taxonomy (slice 40 step_02 frontend half).
//
// Backend error codes from translator / session / profile layers map to a
// single TS taxonomy that drives:
//   * recovery copy in the UI;
//   * retryability hint;
//   * severity for notify lane and audit;
//   * whether the error should be muted, inline, sticky, or modal.
//
// This module is intentionally additive over `notifyClass` /
// `notifyAttention` / `profileDenial`: it consumes their decisions and
// produces a richer record for surfaces that care about retry semantics
// (e.g. ApprovalQueue, ReleaseTab).

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';
export type ErrorRetryability = 'idempotent_retry' | 'manual_retry' | 'no_retry';
export type ErrorRecoveryHint =
	| 'check_profile'
	| 'check_connectivity'
	| 'check_audit'
	| 'reload_session'
	| 'reauthenticate'
	| 'wait_and_retry'
	| 'contact_admin'
	| 'no_action';

export interface ErrorTaxonomyEntry {
	readonly code: string;
	readonly severity: ErrorSeverity;
	readonly retryable: ErrorRetryability;
	readonly recovery: ErrorRecoveryHint;
	readonly auditRequired: boolean;
	readonly userMessage: string;
}

const FALLBACK: ErrorTaxonomyEntry = Object.freeze({
	code: '',
	severity: 'error',
	retryable: 'manual_retry',
	recovery: 'no_action',
	auditRequired: false,
	userMessage: 'Something went wrong. Please try again.',
});

const ENTRIES: Record<string, Omit<ErrorTaxonomyEntry, 'code'>> = {
	// Profile / authorization
	'profile.denied': {
		severity: 'error',
		retryable: 'no_retry',
		recovery: 'check_profile',
		auditRequired: true,
		userMessage: 'Your profile does not allow this action.',
	},
	'auth.unauthorized': {
		severity: 'critical',
		retryable: 'no_retry',
		recovery: 'reauthenticate',
		auditRequired: true,
		userMessage: 'Authentication is required.',
	},
	// Session
	'session.not_found': {
		severity: 'warning',
		retryable: 'manual_retry',
		recovery: 'reload_session',
		auditRequired: false,
		userMessage: 'Session was not found. Reload to continue.',
	},
	'session.closed': {
		severity: 'info',
		retryable: 'manual_retry',
		recovery: 'reload_session',
		auditRequired: false,
		userMessage: 'Session has ended.',
	},
	// Feature wiring
	'feature.not_wired': {
		severity: 'info',
		retryable: 'no_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'This feature is not wired yet.',
	},
	// Audit
	'audit.write_failed': {
		severity: 'critical',
		retryable: 'idempotent_retry',
		recovery: 'check_audit',
		auditRequired: true,
		userMessage: 'Audit log write failed; the action was not committed.',
	},
	// Persistence
	'persistence.write_failed': {
		severity: 'error',
		retryable: 'idempotent_retry',
		recovery: 'wait_and_retry',
		auditRequired: true,
		userMessage: 'Persistence write failed. Retrying may help.',
	},
	// Runtime jobs
	'runtime.job_not_cancellable': {
		severity: 'info',
		retryable: 'no_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'This job cannot be cancelled.',
	},
	'runtime.job_not_found': {
		severity: 'warning',
		retryable: 'no_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'Job is no longer running.',
	},
	// Gate
	'gate.reason_required': {
		severity: 'warning',
		retryable: 'manual_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'A reason is required for gate override.',
	},
	'gate.expiry_required': {
		severity: 'warning',
		retryable: 'manual_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'An expiry date is required for gate override.',
	},
	'gate.expiry_in_past': {
		severity: 'warning',
		retryable: 'manual_retry',
		recovery: 'no_action',
		auditRequired: false,
		userMessage: 'Override expiry must be in the future.',
	},
};

export function errorTaxonomyFor(code: string): ErrorTaxonomyEntry {
	if (typeof code !== 'string' || code.length === 0) return FALLBACK;
	const hit = ENTRIES[code];
	return hit ? { code, ...hit } : { ...FALLBACK, code };
}

export function isRetryable(code: string): boolean {
	return errorTaxonomyFor(code).retryable !== 'no_retry';
}

export function requiresAudit(code: string): boolean {
	return errorTaxonomyFor(code).auditRequired;
}

export const ERROR_TAXONOMY_CODES: ReadonlyArray<string> = Object.freeze(Object.keys(ENTRIES));
export { FALLBACK as ERROR_TAXONOMY_FALLBACK };
