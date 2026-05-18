// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/event.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    #[serde(rename = "session.ready")]
    SessionReady,
    #[serde(rename = "session.snapshot")]
    SessionSnapshot,
    #[serde(rename = "session.updated")]
    SessionUpdated,
    #[serde(rename = "session.closed")]
    SessionClosed,
    #[serde(rename = "transcript.message_added")]
    TranscriptMessageAdded,
    #[serde(rename = "transcript.delta")]
    TranscriptDelta,
    #[serde(rename = "transcript.completed")]
    TranscriptCompleted,
    #[serde(rename = "transcript.error")]
    TranscriptError,
    #[serde(rename = "approval.pending")]
    ApprovalPending,
    #[serde(rename = "approval.resolved")]
    ApprovalResolved,
    #[serde(rename = "approval.expired")]
    ApprovalExpired,
    #[serde(rename = "workbench.state")]
    WorkbenchState,
    #[serde(rename = "review.diff_ready")]
    ReviewDiffReady,
    #[serde(rename = "review.changeset_updated")]
    ReviewChangesetUpdated,
    #[serde(rename = "runtime.jobs_updated")]
    RuntimeJobsUpdated,
    #[serde(rename = "runtime.job_log")]
    RuntimeJobLog,
    #[serde(rename = "plan.updated")]
    PlanUpdated,
    #[serde(rename = "shell.started")]
    ShellStarted,
    #[serde(rename = "shell.output")]
    ShellOutput,
    #[serde(rename = "shell.exited")]
    ShellExited,
    #[serde(rename = "system_pulse.updated")]
    SystemPulseUpdated,
    #[serde(rename = "notify.event")]
    NotifyEvent,
    #[serde(rename = "overlay.opened")]
    OverlayOpened,
    #[serde(rename = "overlay.dismissed")]
    OverlayDismissed,
    #[serde(rename = "activity.appended")]
    ActivityAppended,
    #[serde(rename = "assessment.started")]
    AssessmentStarted,
    #[serde(rename = "assessment.progress")]
    AssessmentProgress,
    #[serde(rename = "assessment.candidate_received")]
    AssessmentCandidateReceived,
    #[serde(rename = "assessment.candidate_rejected")]
    AssessmentCandidateRejected,
    #[serde(rename = "assessment.finding_added")]
    AssessmentFindingAdded,
    #[serde(rename = "assessment.evidence_attached")]
    AssessmentEvidenceAttached,
    #[serde(rename = "assessment.evidence_stale_detected")]
    AssessmentEvidenceStaleDetected,
    #[serde(rename = "assessment.completed")]
    AssessmentCompleted,
    #[serde(rename = "assessment.failed")]
    AssessmentFailed,
    #[serde(rename = "assessment.diff_ready")]
    AssessmentDiffReady,
    #[serde(rename = "handoff.created")]
    HandoffCreated,
    #[serde(rename = "handoff.approved")]
    HandoffApproved,
    #[serde(rename = "handoff.rejected")]
    HandoffRejected,
    #[serde(rename = "handoff.dispatched")]
    HandoffDispatched,
    #[serde(rename = "handoff.execution_progress")]
    HandoffExecutionProgress,
    #[serde(rename = "handoff.completed")]
    HandoffCompleted,
    #[serde(rename = "handoff.invalidated")]
    HandoffInvalidated,
    #[serde(rename = "handoff.expired")]
    HandoffExpired,
    #[serde(rename = "gate.state_changed")]
    GateStateChanged,
    #[serde(rename = "gate.override_applied")]
    GateOverrideApplied,
    #[serde(rename = "gate.override_revoked")]
    GateOverrideRevoked,
    #[serde(rename = "connector.connected")]
    ConnectorConnected,
    #[serde(rename = "connector.disconnected")]
    ConnectorDisconnected,
    #[serde(rename = "connector.health")]
    ConnectorHealth,
    #[serde(rename = "connector.rate_limited")]
    ConnectorRateLimited,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventVersion;

impl EventVersion {
    pub const VALUE: i64 = 1;
}

impl Serialize for EventVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_i64(Self::VALUE)
    }
}

impl<'de> Deserialize<'de> for EventVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = i64::deserialize(deserializer)?;
        if value == Self::VALUE {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom(format!(
                "unsupported protocol version {value}; expected {}",
                Self::VALUE
            )))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub payload: serde_json::Value,
    pub seq: i64,
    pub session_id: String,
    pub ts: String,
    #[serde(rename = "type")]
    pub r#type: EventType,
    pub v: EventVersion,
}
