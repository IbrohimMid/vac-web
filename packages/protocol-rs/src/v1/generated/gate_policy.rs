// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/gate_policy.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatePolicy {
    pub absolute_max_override: String,
    pub allowed_override_roles: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_reevaluate_every: Option<String>,
    pub gate: String,
    pub max_override_duration: String,
    pub min_reason_length: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub non_overridable_criteria: Option<Vec<String>>,
    pub require_evidence_on_override: bool,
    pub require_two_party: bool,
    pub required_criteria: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub two_party_roles: Option<Vec<String>>,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings_block: Option<bool>,
}
