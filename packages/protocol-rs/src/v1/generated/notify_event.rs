// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/notify_event.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotifyEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<super::evidence_ref::EvidenceRef>,
    pub id: String,
    pub lane: String,
    pub message: String,
    pub severity: String,
    pub subsystem: String,
    pub title: String,
    pub ts: String,
}
