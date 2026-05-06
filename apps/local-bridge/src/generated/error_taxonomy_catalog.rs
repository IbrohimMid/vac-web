// AUTO-GENERATED FILE — DO NOT EDIT BY HAND. Source: schema/error-taxonomy.yaml
//
// Run `node scripts/codegen-error-taxonomy.mjs` to regenerate.

#![allow(dead_code)]

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum ErrorSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
#[allow(clippy::enum_variant_names)]
pub enum ErrorRetryability {
    IdempotentRetry,
    ManualRetry,
    NoRetry,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct ErrorTaxonomyEntry {
    pub code: &'static str,
    pub severity: ErrorSeverity,
    pub retryable: ErrorRetryability,
    pub audit_required: bool,
    pub user_message: &'static str,
}

pub const ERROR_TAXONOMY: [ErrorTaxonomyEntry; 12] = [
    ErrorTaxonomyEntry {
        code: "audit.write_failed",
        severity: ErrorSeverity::Critical,
        retryable: ErrorRetryability::IdempotentRetry,
        audit_required: true,
        user_message: "Audit log write failed; the action was not committed.",
    },
    ErrorTaxonomyEntry {
        code: "auth.unauthorized",
        severity: ErrorSeverity::Critical,
        retryable: ErrorRetryability::NoRetry,
        audit_required: true,
        user_message: "Authentication is required.",
    },
    ErrorTaxonomyEntry {
        code: "feature.not_wired",
        severity: ErrorSeverity::Info,
        retryable: ErrorRetryability::NoRetry,
        audit_required: false,
        user_message: "This feature is not wired yet.",
    },
    ErrorTaxonomyEntry {
        code: "gate.expiry_in_past",
        severity: ErrorSeverity::Warning,
        retryable: ErrorRetryability::ManualRetry,
        audit_required: false,
        user_message: "Override expiry must be in the future.",
    },
    ErrorTaxonomyEntry {
        code: "gate.expiry_required",
        severity: ErrorSeverity::Warning,
        retryable: ErrorRetryability::ManualRetry,
        audit_required: false,
        user_message: "An expiry date is required for gate override.",
    },
    ErrorTaxonomyEntry {
        code: "gate.reason_required",
        severity: ErrorSeverity::Warning,
        retryable: ErrorRetryability::ManualRetry,
        audit_required: false,
        user_message: "A reason is required for gate override.",
    },
    ErrorTaxonomyEntry {
        code: "persistence.write_failed",
        severity: ErrorSeverity::Error,
        retryable: ErrorRetryability::IdempotentRetry,
        audit_required: true,
        user_message: "Persistence write failed. Retrying may help.",
    },
    ErrorTaxonomyEntry {
        code: "profile.denied",
        severity: ErrorSeverity::Error,
        retryable: ErrorRetryability::NoRetry,
        audit_required: true,
        user_message: "Your profile does not allow this action.",
    },
    ErrorTaxonomyEntry {
        code: "runtime.job_not_cancellable",
        severity: ErrorSeverity::Info,
        retryable: ErrorRetryability::NoRetry,
        audit_required: false,
        user_message: "This job cannot be cancelled.",
    },
    ErrorTaxonomyEntry {
        code: "runtime.job_not_found",
        severity: ErrorSeverity::Warning,
        retryable: ErrorRetryability::NoRetry,
        audit_required: false,
        user_message: "Job is no longer running.",
    },
    ErrorTaxonomyEntry {
        code: "session.closed",
        severity: ErrorSeverity::Info,
        retryable: ErrorRetryability::ManualRetry,
        audit_required: false,
        user_message: "Session has ended.",
    },
    ErrorTaxonomyEntry {
        code: "session.not_found",
        severity: ErrorSeverity::Warning,
        retryable: ErrorRetryability::ManualRetry,
        audit_required: false,
        user_message: "Session was not found. Reload to continue.",
    },
];

pub fn taxonomy_for(code: &str) -> Option<&'static ErrorTaxonomyEntry> {
    ERROR_TAXONOMY.iter().find(|e| e.code == code)
}
