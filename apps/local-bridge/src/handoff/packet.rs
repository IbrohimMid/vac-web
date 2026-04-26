//! Handoff packet, pin, and task types.
//!
//! These mirror the FE contract in `apps/web/src/stores/handoff.ts`.
//! The bridge owns authoritative field names and enum variants.

use serde::{Deserialize, Serialize};

/// Canonical signer identity for dedup + author self-sign deny.
///
/// The bridge treats whitespace and case as cosmetic. Two display names that
/// only differ in surrounding whitespace or letter case must collapse to the
/// same actor id, otherwise an attacker could bypass the self-sign deny by
/// submitting `"ALICE"` or `"  alice "` instead of `"alice"`.
pub fn canonical_signer_id(name: &str) -> String {
    name.trim().to_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PinPolicy {
    Strict,
    Lenient,
}

impl Default for PinPolicy {
    fn default() -> Self {
        Self::Strict
    }
}

impl PinPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Lenient => "lenient",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "lenient" => Self::Lenient,
            _ => Self::Strict,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffConnectorSnapshot {
    pub connector_id: String,
    pub kind: String,
    pub snapshot_id: String,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPin {
    pub repo_ref: String,
    pub base_commit_sha: String,
    pub worktree_digest: String,
    pub assessment_snapshot_at: String,
    pub connector_snapshots: Vec<HandoffConnectorSnapshot>,
    pub expires_at: String,
    pub invalidate_on_repo_change: bool,
    pub invalidation_policy: PinPolicy,
}

impl HandoffPin {
    pub fn is_complete(&self) -> bool {
        !self.repo_ref.is_empty()
            && !self.base_commit_sha.is_empty()
            && !self.worktree_digest.is_empty()
            && !self.assessment_snapshot_at.is_empty()
            && !self.expires_at.is_empty()
    }

    pub fn is_expired(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.expires_at)
            .map(|dt| dt < chrono::Utc::now())
            .unwrap_or(true)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketTask {
    pub id: String,
    pub title: String,
    pub rationale: String,
    pub source_finding_ids: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<serde_json::Value>,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub risk_notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub est_effort: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub touches_paths: Vec<String>,
    pub requires_approval_per_step: bool,
    #[serde(default)]
    pub rollback_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffTarget {
    pub kind: String,
    pub executor_profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffApproval {
    pub required: bool,
    #[serde(default)]
    pub approvers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approver_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    pub two_party: bool,
    #[serde(default)]
    pub required_roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketStateHistoryEntry {
    pub state: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signer {
    pub name: String,
    pub role: String,
    pub signed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PacketStatus {
    Draft,
    PendingApproval,
    Approved,
    Rejected,
    Dispatched,
    Executing,
    Completed,
    Failed,
    Invalidated,
    Expired,
}

impl Default for PacketStatus {
    fn default() -> Self {
        Self::Draft
    }
}

impl PacketStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::PendingApproval => "pending_approval",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::Dispatched => "dispatched",
            Self::Executing => "executing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Invalidated => "invalidated",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Packet {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default)]
    pub source_run_ids: Vec<String>,
    #[serde(default)]
    pub accepted_finding_ids: Vec<String>,
    pub created_by: String,
    pub created_at: String,
    pub pin: HandoffPin,
    #[serde(default)]
    pub tasks: Vec<PacketTask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_hint: Option<Vec<String>>,
    pub target: HandoffTarget,
    pub approval: HandoffApproval,
    pub status: PacketStatus,
    #[serde(default)]
    pub state_history: Vec<PacketStateHistoryEntry>,
    #[serde(default)]
    pub signers: Vec<Signer>,
    pub required_signers: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_outcome: Option<serde_json::Value>,
    #[serde(default)]
    pub convergence_count: u32,
    pub updated_at: String,
}

impl Packet {
    pub fn can_dispatch(&self) -> bool {
        self.status == PacketStatus::Approved && self.pin.is_complete() && !self.pin.is_expired()
    }

    pub fn add_signer(&mut self, signer: Signer) {
        if !self.signers.iter().any(|s| s.name == signer.name) {
            self.signers.push(signer);
        }
    }
}
