// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_run.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRun {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_snapshots: Option<Vec<AssessmentRunConnectorSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<AssessmentRunCounts>,
    pub family_id: String,
    pub id: String,
    pub profile_hash: String,
    pub profile_id: String,
    pub scope: AssessmentRunScope,
    pub session_id: String,
    pub started_at: String,
    pub status: String,
    pub triggered_by: AssessmentRunTriggeredBy,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<super::assessment_verdict::AssessmentVerdict>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRunConnectorSnapshot {
    pub captured_at: String,
    pub connector_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub kind: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRunCountsFindings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub critical: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub medium: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRunCounts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings: Option<AssessmentRunCountsFindings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRunScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_commit_sha: Option<String>,
    pub depth: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_globs: Option<Vec<String>>,
    pub project_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentRunTriggeredBy {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
}
