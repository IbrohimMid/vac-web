// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: schema/error-taxonomy.yaml
//
// Run `node scripts/codegen-error-taxonomy.mjs` to regenerate.

export type ErrorTaxonomySeverity = 'info' | 'warning' | 'error' | 'critical';
export type ErrorTaxonomyRetryability = 'idempotent_retry' | 'manual_retry' | 'no_retry';
export type ErrorTaxonomyRecovery =
  | 'check_profile'
  | 'check_connectivity'
  | 'check_audit'
  | 'reload_session'
  | 'reauthenticate'
  | 'wait_and_retry'
  | 'contact_admin'
  | 'no_action';

export interface ErrorTaxonomyCatalogEntry {
  readonly code: string;
  readonly severity: ErrorTaxonomySeverity;
  readonly retryable: ErrorTaxonomyRetryability;
  readonly recovery: ErrorTaxonomyRecovery;
  readonly auditRequired: boolean;
  readonly userMessage: string;
}

export const ERROR_TAXONOMY_CATALOG: ReadonlyArray<ErrorTaxonomyCatalogEntry> = Object.freeze([
  Object.freeze({
    code: 'audit.write_failed',
    severity: 'critical',
    retryable: 'idempotent_retry',
    recovery: 'check_audit',
    auditRequired: true,
    userMessage: "Audit log write failed; the action was not committed.",
  }),
  Object.freeze({
    code: 'auth.unauthorized',
    severity: 'critical',
    retryable: 'no_retry',
    recovery: 'reauthenticate',
    auditRequired: true,
    userMessage: "Authentication is required.",
  }),
  Object.freeze({
    code: 'feature.not_wired',
    severity: 'info',
    retryable: 'no_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "This feature is not wired yet.",
  }),
  Object.freeze({
    code: 'gate.expiry_in_past',
    severity: 'warning',
    retryable: 'manual_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "Override expiry must be in the future.",
  }),
  Object.freeze({
    code: 'gate.expiry_required',
    severity: 'warning',
    retryable: 'manual_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "An expiry date is required for gate override.",
  }),
  Object.freeze({
    code: 'gate.not_found',
    severity: 'warning',
    retryable: 'no_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "Gate was not found.",
  }),
  Object.freeze({
    code: 'gate.reason_required',
    severity: 'warning',
    retryable: 'manual_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "A reason is required for gate override.",
  }),
  Object.freeze({
    code: 'persistence.write_failed',
    severity: 'error',
    retryable: 'idempotent_retry',
    recovery: 'wait_and_retry',
    auditRequired: true,
    userMessage: "Persistence write failed. Retrying may help.",
  }),
  Object.freeze({
    code: 'profile.denied',
    severity: 'error',
    retryable: 'no_retry',
    recovery: 'check_profile',
    auditRequired: true,
    userMessage: "Your profile does not allow this action.",
  }),
  Object.freeze({
    code: 'release.gate_not_ready',
    severity: 'warning',
    retryable: 'manual_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "Required release gates are not ready yet.",
  }),
  Object.freeze({
    code: 'release.target_not_found',
    severity: 'warning',
    retryable: 'no_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "Release target was not found.",
  }),
  Object.freeze({
    code: 'runtime.job_not_cancellable',
    severity: 'info',
    retryable: 'no_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "This job cannot be cancelled.",
  }),
  Object.freeze({
    code: 'runtime.job_not_found',
    severity: 'warning',
    retryable: 'no_retry',
    recovery: 'no_action',
    auditRequired: false,
    userMessage: "Job is no longer running.",
  }),
  Object.freeze({
    code: 'session.closed',
    severity: 'info',
    retryable: 'manual_retry',
    recovery: 'reload_session',
    auditRequired: false,
    userMessage: "Session has ended.",
  }),
  Object.freeze({
    code: 'session.not_found',
    severity: 'warning',
    retryable: 'manual_retry',
    recovery: 'reload_session',
    auditRequired: false,
    userMessage: "Session was not found. Reload to continue.",
  }),
]);

export const ERROR_TAXONOMY_CATALOG_BY_CODE: ReadonlyMap<string, ErrorTaxonomyCatalogEntry> =
  new Map(ERROR_TAXONOMY_CATALOG.map((e) => [e.code, e]));
