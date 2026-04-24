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
