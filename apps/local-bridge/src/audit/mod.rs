//! Audit facility wrapper over `bridge-core::AuditWriter`.

use crate::server::AppStateHandle;
use bridge_core::{AuditConfig, AuditEntry, AuditSeverity, AuditWriter};
use serde_json::Value;
use std::path::PathBuf;

pub struct AuditFacility {
    writer: AuditWriter,
}

impl AuditFacility {
    pub fn new(dir: PathBuf) -> Self {
        let writer = AuditWriter::spawn(AuditConfig {
            dir,
            channel_cap: 8192,
        });
        Self { writer }
    }

    pub fn log(&self, session_id: &str, subsystem: &str, severity: AuditSeverity, fields: Value) {
        self.writer.log(
            AuditEntry::new(session_id, subsystem)
                .severity(severity)
                .fields(fields),
        );
    }

    pub fn dropped(&self) -> u64 {
        self.writer.dropped()
    }
}

pub fn log_tool_event(state: &AppStateHandle, session_id: &str, subsystem: &str, fields: Value) {
    state
        .audit
        .log(session_id, subsystem, AuditSeverity::Info, fields);
}

/// Slice 41: structured-log adapter on top of
/// [`crate::observability::StructuredLogBuilder`].
///
/// Builds a schema-validated log payload from the fluent builder, then
/// routes it to the audit facility with the matching severity. Returns
/// the validation error verbatim so callers can surface it in their
/// own diagnostics; the audit write is skipped on validation failure
/// to avoid emitting malformed entries.
///
/// This is the safe, additive migration target for emit sites that
/// today call `state.audit.log(…, AuditSeverity::Info, fields)` with a
/// hand-rolled `serde_json::Value`. New emitters should prefer this
/// helper; existing call sites can migrate one-by-one.
pub fn log_structured(
    state: &AppStateHandle,
    subsystem: &str,
    builder: crate::observability::StructuredLogBuilder,
) -> Result<(), crate::observability::LogValidationError> {
    use crate::observability::LogSeverity;
    let severity = builder.severity_for_audit();
    let session_id = builder.session_id_for_audit().to_string();
    let value = builder.build()?;
    let mapped = match severity {
        LogSeverity::Info => AuditSeverity::Info,
        LogSeverity::Warning => AuditSeverity::Warn,
        LogSeverity::Error => AuditSeverity::Error,
        LogSeverity::Critical => AuditSeverity::Error,
    };
    state.audit.log(&session_id, subsystem, mapped, value);
    Ok(())
}
