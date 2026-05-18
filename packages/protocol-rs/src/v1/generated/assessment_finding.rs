// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_finding.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentFinding {
    pub category: String,
    pub confidence: f64,
    pub created_at: String,
    pub description: String,
    pub emitted_by: String,
    pub evidence: Vec<super::evidence_ref::EvidenceRef>,
    pub family_id: String,
    pub fixability: String,
    pub id: String,
    pub identity_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    pub run_id: String,
    pub severity: String,
    pub subsystem: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_fix: Option<AssessmentFindingSuggestedFix>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentFindingSuggestedFix {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor_profile_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<String>>,
}
