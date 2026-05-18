// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/event.schema.json

use serde::{Deserialize, Serialize};

use serde::ser::SerializeStruct;

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

#[derive(Debug, Clone, PartialEq)]
pub enum EventPayload {
    TranscriptDelta(EventTranscriptDeltaPayload),
    TranscriptCompleted(EventTranscriptCompletedPayload),
    TranscriptError(EventTranscriptErrorPayload),
    AssessmentStarted(EventAssessmentStartedPayload),
    AssessmentProgress(EventAssessmentProgressPayload),
    AssessmentCompleted(EventAssessmentCompletedPayload),
    AssessmentFailed(EventAssessmentFailedPayload),
    ApprovalPending(EventApprovalPendingPayload),
    ApprovalResolved(EventApprovalResolvedPayload),
    HandoffCreated(EventHandoffCreatedPayload),
    HandoffApproved(EventHandoffApprovedPayload),
    HandoffRejected(EventHandoffRejectedPayload),
    HandoffDispatched(EventHandoffDispatchedPayload),
    HandoffCompleted(EventHandoffCompletedPayload),
    GateStateChanged(EventGateStateChangedPayload),
    GateOverrideApplied(EventGateOverrideAppliedPayload),
    GateOverrideRevoked(EventGateOverrideRevokedPayload),
    Other(serde_json::Value),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventTranscriptDeltaPayload {
    pub message_id: String,
    pub delta: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventTranscriptCompletedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventTranscriptErrorPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventAssessmentStartedPayload {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventAssessmentProgressPayload {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventAssessmentCompletedPayload {
    pub run_id: String,
    pub verdict: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventAssessmentFailedPayload {
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventApprovalPendingPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventApprovalResolvedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventHandoffCreatedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventHandoffApprovedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventHandoffRejectedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventHandoffDispatchedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventHandoffCompletedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventGateStateChangedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventGateOverrideAppliedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventGateOverrideRevokedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

impl EventPayload {
    fn deserialize_for_type<E>(r#type: EventType, value: serde_json::Value) -> Result<Self, E>
    where
        E: serde::de::Error,
    {
        match r#type {
            EventType::TranscriptDelta => {
                serde_json::from_value::<EventTranscriptDeltaPayload>(value)
                    .map(Self::TranscriptDelta)
                    .map_err(E::custom)
            }
            EventType::TranscriptCompleted => {
                serde_json::from_value::<EventTranscriptCompletedPayload>(value)
                    .map(Self::TranscriptCompleted)
                    .map_err(E::custom)
            }
            EventType::TranscriptError => {
                serde_json::from_value::<EventTranscriptErrorPayload>(value)
                    .map(Self::TranscriptError)
                    .map_err(E::custom)
            }
            EventType::AssessmentStarted => {
                serde_json::from_value::<EventAssessmentStartedPayload>(value)
                    .map(Self::AssessmentStarted)
                    .map_err(E::custom)
            }
            EventType::AssessmentProgress => {
                serde_json::from_value::<EventAssessmentProgressPayload>(value)
                    .map(Self::AssessmentProgress)
                    .map_err(E::custom)
            }
            EventType::AssessmentCompleted => {
                serde_json::from_value::<EventAssessmentCompletedPayload>(value)
                    .map(Self::AssessmentCompleted)
                    .map_err(E::custom)
            }
            EventType::AssessmentFailed => {
                serde_json::from_value::<EventAssessmentFailedPayload>(value)
                    .map(Self::AssessmentFailed)
                    .map_err(E::custom)
            }
            EventType::ApprovalPending => {
                serde_json::from_value::<EventApprovalPendingPayload>(value)
                    .map(Self::ApprovalPending)
                    .map_err(E::custom)
            }
            EventType::ApprovalResolved => {
                serde_json::from_value::<EventApprovalResolvedPayload>(value)
                    .map(Self::ApprovalResolved)
                    .map_err(E::custom)
            }
            EventType::HandoffCreated => {
                serde_json::from_value::<EventHandoffCreatedPayload>(value)
                    .map(Self::HandoffCreated)
                    .map_err(E::custom)
            }
            EventType::HandoffApproved => {
                serde_json::from_value::<EventHandoffApprovedPayload>(value)
                    .map(Self::HandoffApproved)
                    .map_err(E::custom)
            }
            EventType::HandoffRejected => {
                serde_json::from_value::<EventHandoffRejectedPayload>(value)
                    .map(Self::HandoffRejected)
                    .map_err(E::custom)
            }
            EventType::HandoffDispatched => {
                serde_json::from_value::<EventHandoffDispatchedPayload>(value)
                    .map(Self::HandoffDispatched)
                    .map_err(E::custom)
            }
            EventType::HandoffCompleted => {
                serde_json::from_value::<EventHandoffCompletedPayload>(value)
                    .map(Self::HandoffCompleted)
                    .map_err(E::custom)
            }
            EventType::GateStateChanged => {
                serde_json::from_value::<EventGateStateChangedPayload>(value)
                    .map(Self::GateStateChanged)
                    .map_err(E::custom)
            }
            EventType::GateOverrideApplied => {
                serde_json::from_value::<EventGateOverrideAppliedPayload>(value)
                    .map(Self::GateOverrideApplied)
                    .map_err(E::custom)
            }
            EventType::GateOverrideRevoked => {
                serde_json::from_value::<EventGateOverrideRevokedPayload>(value)
                    .map(Self::GateOverrideRevoked)
                    .map_err(E::custom)
            }
            _ => Ok(Self::Other(value)),
        }
    }

    fn serialize_for_type<S>(&self, r#type: EventType) -> Result<serde_json::Value, S::Error>
    where
        S: serde::Serializer,
    {
        match (r#type, self) {
            (EventType::TranscriptDelta, Self::TranscriptDelta(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::TranscriptCompleted, Self::TranscriptCompleted(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::TranscriptError, Self::TranscriptError(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::AssessmentStarted, Self::AssessmentStarted(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::AssessmentProgress, Self::AssessmentProgress(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::AssessmentCompleted, Self::AssessmentCompleted(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::AssessmentFailed, Self::AssessmentFailed(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::ApprovalPending, Self::ApprovalPending(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::ApprovalResolved, Self::ApprovalResolved(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::HandoffCreated, Self::HandoffCreated(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::HandoffApproved, Self::HandoffApproved(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::HandoffRejected, Self::HandoffRejected(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::HandoffDispatched, Self::HandoffDispatched(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::HandoffCompleted, Self::HandoffCompleted(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::GateStateChanged, Self::GateStateChanged(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::GateOverrideApplied, Self::GateOverrideApplied(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (EventType::GateOverrideRevoked, Self::GateOverrideRevoked(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (_, Self::Other(value)) => Ok(value.clone()),
            (actual, payload) => Err(serde::ser::Error::custom(format!(
                "payload variant {payload:?} does not match type {actual:?}"
            ))),
        }
    }
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

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub payload: EventPayload,
    pub seq: i64,
    pub session_id: String,
    pub ts: String,
    pub r#type: EventType,
    pub v: EventVersion,
}

#[derive(Deserialize)]
struct EventRaw {
    payload: serde_json::Value,
    seq: i64,
    session_id: String,
    ts: String,
    #[serde(rename = "type")]
    r#type: EventType,
    v: EventVersion,
}

impl<'de> Deserialize<'de> for Event {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = EventRaw::deserialize(deserializer)?;
        let payload = EventPayload::deserialize_for_type::<D::Error>(raw.r#type, raw.payload)?;
        Ok(Self {
            payload,
            seq: raw.seq,
            session_id: raw.session_id,
            ts: raw.ts,
            r#type: raw.r#type,
            v: raw.v,
        })
    }
}

impl Serialize for Event {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("Event", 6)?;
        let payload = self.payload.serialize_for_type::<S>(self.r#type)?;
        state.serialize_field("payload", &payload)?;
        state.serialize_field("seq", &self.seq)?;
        state.serialize_field("session_id", &self.session_id)?;
        state.serialize_field("ts", &self.ts)?;
        state.serialize_field("type", &self.r#type)?;
        state.serialize_field("v", &self.v)?;
        state.end()
    }
}
