// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/assessment_diff.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiff {
    pub base_run_id: String,
    pub computed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub convergence_counter: Option<i64>,
    pub family_id: String,
    pub head_run_id: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_findings: Option<Vec<AssessmentDiffNewFinding>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistent: Option<Vec<AssessmentDiffPersistent>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regressed: Option<Vec<AssessmentDiffRegressed>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<Vec<AssessmentDiffResolved>>,
    pub verdict_delta: AssessmentDiffVerdictDelta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiffNewFinding {
    pub finding_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiffPersistent {
    pub finding_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unchanged_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiffRegressed {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drift_evidence: Option<Vec<super::evidence_ref::EvidenceRef>>,
    pub finding_id: String,
    pub severity_after: String,
    pub severity_before: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiffResolved {
    pub finding_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_evidence: Option<Vec<super::evidence_ref::EvidenceRef>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssessmentDiffVerdictDelta {
    pub after: super::assessment_verdict::AssessmentVerdict,
    pub before: super::assessment_verdict::AssessmentVerdict,
    pub direction: String,
}
