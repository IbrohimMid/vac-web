// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/gate_status.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateStatus {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blockers: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<serde_json::Value>,
    pub criteria: Vec<GateStatusCriteria>,
    pub gate: String,
    pub last_evaluated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_auto_evaluation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overrides: Option<Vec<GateStatusOverride>>,
    pub project_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign_offs: Option<Vec<GateStatusSignOff>>,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateStatusCriteria {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<super::evidence_ref::EvidenceRef>,
    pub id: String,
    pub required: bool,
    pub satisfied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateStatusOverride {
    pub applied_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attached_evidence_refs: Option<Vec<super::evidence_ref::EvidenceRef>>,
    pub by: String,
    pub expires_at: String,
    pub id: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoke_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_by: Option<String>,
    pub role: String,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GateStatusSignOff {
    pub at: String,
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub role: String,
}
