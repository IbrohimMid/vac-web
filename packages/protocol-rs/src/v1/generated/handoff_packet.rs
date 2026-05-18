// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/handoff_packet.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacket {
    pub accepted_finding_ids: Vec<String>,
    pub approval: HandoffPacketApproval,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chained_from_handoff_id: Option<String>,
    pub created_at: String,
    pub created_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_outcome: Option<HandoffPacketExecutionOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_session_id: Option<String>,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_hint: Option<Vec<String>>,
    pub pin: HandoffPacketPin,
    pub source_run_ids: Vec<String>,
    pub state: String,
    pub state_history: Vec<HandoffPacketStateHistory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub target: HandoffPacketTarget,
    pub tasks: Vec<HandoffPacketTask>,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketApproval {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approver_notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approvers: Option<Vec<String>>,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_roles: Option<Vec<String>>,
    pub two_party: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketExecutionOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changeset_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reassessment_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tasks_completed: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tasks_failed: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketPinConnectorSnapshot {
    pub captured_at: String,
    pub connector_id: String,
    pub kind: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketPin {
    pub assessment_snapshot_at: String,
    pub base_commit_sha: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_snapshots: Option<Vec<HandoffPacketPinConnectorSnapshot>>,
    pub expires_at: String,
    pub invalidate_on_repo_change: bool,
    pub invalidation_policy: String,
    pub repo_ref: String,
    pub worktree_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketStateHistory {
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketTarget {
    pub executor_profile_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandoffPacketTask {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub est_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_refs: Option<Vec<super::evidence_ref::EvidenceRef>>,
    pub id: String,
    pub rationale: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_approval_per_step: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_notes: Option<Vec<String>>,
    pub steps: Vec<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub touches_paths: Option<Vec<String>>,
}
