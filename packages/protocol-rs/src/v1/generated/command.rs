// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/command.schema.json

use serde::{Deserialize, Serialize};

use serde::ser::SerializeStruct;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandType {
    #[serde(rename = "approval.approve")]
    ApprovalApprove,
    #[serde(rename = "approval.approve_all")]
    ApprovalApproveAll,
    #[serde(rename = "approval.inspect")]
    ApprovalInspect,
    #[serde(rename = "approval.reject")]
    ApprovalReject,
    #[serde(rename = "assessment.cancel")]
    AssessmentCancel,
    #[serde(rename = "assessment.diff")]
    AssessmentDiff,
    #[serde(rename = "assessment.fetch_evidence_preview")]
    AssessmentFetchEvidencePreview,
    #[serde(rename = "assessment.fetch_report")]
    AssessmentFetchReport,
    #[serde(rename = "assessment.index.rebuild")]
    AssessmentIndexRebuild,
    #[serde(rename = "assessment.index.status")]
    AssessmentIndexStatus,
    #[serde(rename = "assessment.list_runs")]
    AssessmentListRuns,
    #[serde(rename = "assessment.replay")]
    AssessmentReplay,
    #[serde(rename = "assessment.run")]
    AssessmentRun,
    #[serde(rename = "assessment.sweep.cancel")]
    AssessmentSweepCancel,
    #[serde(rename = "assessment.sweep.run")]
    AssessmentSweepRun,
    #[serde(rename = "bridge.mutation.approve")]
    BridgeMutationApprove,
    #[serde(rename = "bridge.mutation.refine_request")]
    BridgeMutationRefineRequest,
    #[serde(rename = "bridge.mutation.reject")]
    BridgeMutationReject,
    #[serde(rename = "coding.context.ask_about_file")]
    CodingContextAskAboutFile,
    #[serde(rename = "coding.context.ask_about_selection")]
    CodingContextAskAboutSelection,
    #[serde(rename = "coding.context.request_edit")]
    CodingContextRequestEdit,
    #[serde(rename = "coding.context.request_tests")]
    CodingContextRequestTests,
    #[serde(rename = "config.policy.get")]
    ConfigPolicyGet,
    #[serde(rename = "config.reload")]
    ConfigReload,
    #[serde(rename = "config.validate")]
    ConfigValidate,
    #[serde(rename = "connector.capabilities")]
    ConnectorCapabilities,
    #[serde(rename = "connector.connect")]
    ConnectorConnect,
    #[serde(rename = "connector.disconnect")]
    ConnectorDisconnect,
    #[serde(rename = "connector.health")]
    ConnectorHealth,
    #[serde(rename = "connector.list")]
    ConnectorList,
    #[serde(rename = "context.attach_files")]
    ContextAttachFiles,
    #[serde(rename = "context.mention_search")]
    ContextMentionSearch,
    #[serde(rename = "continuous.write_config")]
    ContinuousWriteConfig,
    #[serde(rename = "extensions.approve_promotion")]
    ExtensionsApprovePromotion,
    #[serde(rename = "extensions.list")]
    ExtensionsList,
    #[serde(rename = "extensions.list_approvals")]
    ExtensionsListApprovals,
    #[serde(rename = "extensions.request_promotion")]
    ExtensionsRequestPromotion,
    #[serde(rename = "extensions.update_trust")]
    ExtensionsUpdateTrust,
    #[serde(rename = "gate.evaluate")]
    GateEvaluate,
    #[serde(rename = "gate.override")]
    GateOverride,
    #[serde(rename = "gate.revoke_override")]
    GateRevokeOverride,
    #[serde(rename = "gate.signoff")]
    GateSignoff,
    #[serde(rename = "gate.sync_mutation_audit")]
    GateSyncMutationAudit,
    #[serde(rename = "handoff.approve")]
    HandoffApprove,
    #[serde(rename = "handoff.cancel")]
    HandoffCancel,
    #[serde(rename = "handoff.create")]
    HandoffCreate,
    #[serde(rename = "handoff.dispatch_local")]
    HandoffDispatchLocal,
    #[serde(rename = "handoff.dispatch_web_cli")]
    HandoffDispatchWebCli,
    #[serde(rename = "handoff.export_blueprint")]
    HandoffExportBlueprint,
    #[serde(rename = "handoff.fetch")]
    HandoffFetch,
    #[serde(rename = "handoff.reject")]
    HandoffReject,
    #[serde(rename = "handoff.status")]
    HandoffStatus,
    #[serde(rename = "message.cancel_stream")]
    MessageCancelStream,
    #[serde(rename = "message.retry")]
    MessageRetry,
    #[serde(rename = "message.submit")]
    MessageSubmit,
    #[serde(rename = "migration.create_draft")]
    MigrationCreateDraft,
    #[serde(rename = "migration.dispatch")]
    MigrationDispatch,
    #[serde(rename = "migration.dry_run")]
    MigrationDryRun,
    #[serde(rename = "migration.verify_reversibility")]
    MigrationVerifyReversibility,
    #[serde(rename = "overlay.dismiss")]
    OverlayDismiss,
    #[serde(rename = "overlay.dismiss_all")]
    OverlayDismissAll,
    #[serde(rename = "overlay.open")]
    OverlayOpen,
    #[serde(rename = "palette.invoke_action")]
    PaletteInvokeAction,
    #[serde(rename = "perf.latest_run")]
    PerfLatestRun,
    #[serde(rename = "plan.approve")]
    PlanApprove,
    #[serde(rename = "plan.edit")]
    PlanEdit,
    #[serde(rename = "plan.open")]
    PlanOpen,
    #[serde(rename = "plan.reject")]
    PlanReject,
    #[serde(rename = "project.file.request")]
    ProjectFileRequest,
    #[serde(rename = "project.tree.request")]
    ProjectTreeRequest,
    #[serde(rename = "registry.add")]
    RegistryAdd,
    #[serde(rename = "registry.reload")]
    RegistryReload,
    #[serde(rename = "registry.sync")]
    RegistrySync,
    #[serde(rename = "release.deploy")]
    ReleaseDeploy,
    #[serde(rename = "release.generate_notes")]
    ReleaseGenerateNotes,
    #[serde(rename = "release.list_targets")]
    ReleaseListTargets,
    #[serde(rename = "release.publish")]
    ReleasePublish,
    #[serde(rename = "review.hunk.action.request")]
    ReviewHunkActionRequest,
    #[serde(rename = "review.open_file")]
    ReviewOpenFile,
    #[serde(rename = "review.revert_all")]
    ReviewRevertAll,
    #[serde(rename = "review.revert_file")]
    ReviewRevertFile,
    #[serde(rename = "review.toggle_hunk")]
    ReviewToggleHunk,
    #[serde(rename = "runtime.cancel_job")]
    RuntimeCancelJob,
    #[serde(rename = "runtime.inspect_job")]
    RuntimeInspectJob,
    #[serde(rename = "runtime.list_jobs")]
    RuntimeListJobs,
    #[serde(rename = "session.authenticate")]
    SessionAuthenticate,
    #[serde(rename = "session.close")]
    SessionClose,
    #[serde(rename = "session.config_option.set")]
    SessionConfigOptionSet,
    #[serde(rename = "session.create")]
    SessionCreate,
    #[serde(rename = "session.history.forget")]
    SessionHistoryForget,
    #[serde(rename = "session.history.list")]
    SessionHistoryList,
    #[serde(rename = "session.list")]
    SessionList,
    #[serde(rename = "session.mode.set")]
    SessionModeSet,
    #[serde(rename = "session.rename")]
    SessionRename,
    #[serde(rename = "session.resume")]
    SessionResume,
    #[serde(rename = "session.snapshot")]
    SessionSnapshot,
    #[serde(rename = "shell.input")]
    ShellInput,
    #[serde(rename = "shell.kill")]
    ShellKill,
    #[serde(rename = "shell.resize")]
    ShellResize,
    #[serde(rename = "shell.start")]
    ShellStart,
    #[serde(rename = "system.capabilities")]
    SystemCapabilities,
    #[serde(rename = "system.ping")]
    SystemPing,
    #[serde(rename = "system.version")]
    SystemVersion,
    #[serde(rename = "task.execution.continue")]
    TaskExecutionContinue,
    #[serde(rename = "task.plan.request_changes")]
    TaskPlanRequestChanges,
    #[serde(rename = "validation.failure.send_context")]
    ValidationFailureSendContext,
    #[serde(rename = "validation.run.request")]
    ValidationRunRequest,
    #[serde(rename = "workbench.invoke")]
    WorkbenchInvoke,
    #[serde(rename = "workbench.select_tab")]
    WorkbenchSelectTab,
    #[serde(rename = "workspace.branch.request")]
    WorkspaceBranchRequest,
    #[serde(rename = "workspace.preview.open")]
    WorkspacePreviewOpen,
    #[serde(rename = "workspace.preview.refresh")]
    WorkspacePreviewRefresh,
    #[serde(rename = "workspace.preview.run_e2e")]
    WorkspacePreviewRunE2e,
    #[serde(rename = "workspace.preview.send_context")]
    WorkspacePreviewSendContext,
    #[serde(rename = "workspace.preview.stop")]
    WorkspacePreviewStop,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CommandPayload {
    MessageSubmit(CommandMessageSubmitPayload),
    ApprovalApprove(CommandApprovalApprovePayload),
    ApprovalReject(CommandApprovalRejectPayload),
    SessionCreate(CommandSessionCreatePayload),
    GateSignoff(CommandGateSignoffPayload),
    GateOverride(CommandGateOverridePayload),
    GateRevokeOverride(CommandGateRevokeOverridePayload),
    HandoffApprove(CommandHandoffApprovePayload),
    HandoffDispatchLocal(CommandHandoffDispatchLocalPayload),
    HandoffReject(CommandHandoffRejectPayload),
    HandoffStatus(CommandHandoffStatusPayload),
    AssessmentRun(CommandAssessmentRunPayload),
    AssessmentFetchReport(CommandAssessmentFetchReportPayload),
    AssessmentReplay(CommandAssessmentReplayPayload),
    AssessmentCancel(CommandAssessmentCancelPayload),
    AssessmentDiff(CommandAssessmentDiffPayload),
    ReleaseDeploy(CommandReleaseDeployPayload),
    ReleasePublish(CommandReleasePublishPayload),
    ReleaseGenerateNotes(CommandReleaseGenerateNotesPayload),
    ShellStart(CommandShellStartPayload),
    ShellInput(CommandShellInputPayload),
    ShellKill(CommandShellKillPayload),
    ShellResize(CommandShellResizePayload),
    Other(serde_json::Value),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandMessageSubmitPayload {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandApprovalApprovePayload {
    pub approval_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandApprovalRejectPayload {
    pub approval_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandSessionCreatePayload {
    pub project_root: String,
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandGateSignoffPayload {
    pub gate_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandGateOverridePayload {
    pub gate_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandGateRevokeOverridePayload {
    pub gate_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandHandoffApprovePayload {
    pub handoff_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandHandoffDispatchLocalPayload {
    pub handoff_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandHandoffRejectPayload {
    pub handoff_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandHandoffStatusPayload {
    pub handoff_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandAssessmentRunPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub families: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandAssessmentFetchReportPayload {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandAssessmentReplayPayload {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandAssessmentCancelPayload {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandAssessmentDiffPayload {
    pub base_run_id: String,
    pub next_run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandReleaseDeployPayload {
    pub target_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandReleasePublishPayload {
    pub target_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandReleaseGenerateNotesPayload {
    pub target_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandShellStartPayload {
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandShellInputPayload {
    pub terminal_id: String,
    pub input: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandShellKillPayload {
    pub terminal_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandShellResizePayload {
    pub terminal_id: String,
}

impl CommandPayload {
    fn deserialize_for_type<E>(r#type: CommandType, value: serde_json::Value) -> Result<Self, E>
    where
        E: serde::de::Error,
    {
        match r#type {
            CommandType::MessageSubmit => {
                serde_json::from_value::<CommandMessageSubmitPayload>(value)
                    .map(Self::MessageSubmit)
                    .map_err(E::custom)
            }
            CommandType::ApprovalApprove => {
                serde_json::from_value::<CommandApprovalApprovePayload>(value)
                    .map(Self::ApprovalApprove)
                    .map_err(E::custom)
            }
            CommandType::ApprovalReject => {
                serde_json::from_value::<CommandApprovalRejectPayload>(value)
                    .map(Self::ApprovalReject)
                    .map_err(E::custom)
            }
            CommandType::SessionCreate => {
                serde_json::from_value::<CommandSessionCreatePayload>(value)
                    .map(Self::SessionCreate)
                    .map_err(E::custom)
            }
            CommandType::GateSignoff => serde_json::from_value::<CommandGateSignoffPayload>(value)
                .map(Self::GateSignoff)
                .map_err(E::custom),
            CommandType::GateOverride => {
                serde_json::from_value::<CommandGateOverridePayload>(value)
                    .map(Self::GateOverride)
                    .map_err(E::custom)
            }
            CommandType::GateRevokeOverride => {
                serde_json::from_value::<CommandGateRevokeOverridePayload>(value)
                    .map(Self::GateRevokeOverride)
                    .map_err(E::custom)
            }
            CommandType::HandoffApprove => {
                serde_json::from_value::<CommandHandoffApprovePayload>(value)
                    .map(Self::HandoffApprove)
                    .map_err(E::custom)
            }
            CommandType::HandoffDispatchLocal => {
                serde_json::from_value::<CommandHandoffDispatchLocalPayload>(value)
                    .map(Self::HandoffDispatchLocal)
                    .map_err(E::custom)
            }
            CommandType::HandoffReject => {
                serde_json::from_value::<CommandHandoffRejectPayload>(value)
                    .map(Self::HandoffReject)
                    .map_err(E::custom)
            }
            CommandType::HandoffStatus => {
                serde_json::from_value::<CommandHandoffStatusPayload>(value)
                    .map(Self::HandoffStatus)
                    .map_err(E::custom)
            }
            CommandType::AssessmentRun => {
                serde_json::from_value::<CommandAssessmentRunPayload>(value)
                    .map(Self::AssessmentRun)
                    .map_err(E::custom)
            }
            CommandType::AssessmentFetchReport => {
                serde_json::from_value::<CommandAssessmentFetchReportPayload>(value)
                    .map(Self::AssessmentFetchReport)
                    .map_err(E::custom)
            }
            CommandType::AssessmentReplay => {
                serde_json::from_value::<CommandAssessmentReplayPayload>(value)
                    .map(Self::AssessmentReplay)
                    .map_err(E::custom)
            }
            CommandType::AssessmentCancel => {
                serde_json::from_value::<CommandAssessmentCancelPayload>(value)
                    .map(Self::AssessmentCancel)
                    .map_err(E::custom)
            }
            CommandType::AssessmentDiff => {
                serde_json::from_value::<CommandAssessmentDiffPayload>(value)
                    .map(Self::AssessmentDiff)
                    .map_err(E::custom)
            }
            CommandType::ReleaseDeploy => {
                serde_json::from_value::<CommandReleaseDeployPayload>(value)
                    .map(Self::ReleaseDeploy)
                    .map_err(E::custom)
            }
            CommandType::ReleasePublish => {
                serde_json::from_value::<CommandReleasePublishPayload>(value)
                    .map(Self::ReleasePublish)
                    .map_err(E::custom)
            }
            CommandType::ReleaseGenerateNotes => {
                serde_json::from_value::<CommandReleaseGenerateNotesPayload>(value)
                    .map(Self::ReleaseGenerateNotes)
                    .map_err(E::custom)
            }
            CommandType::ShellStart => serde_json::from_value::<CommandShellStartPayload>(value)
                .map(Self::ShellStart)
                .map_err(E::custom),
            CommandType::ShellInput => serde_json::from_value::<CommandShellInputPayload>(value)
                .map(Self::ShellInput)
                .map_err(E::custom),
            CommandType::ShellKill => serde_json::from_value::<CommandShellKillPayload>(value)
                .map(Self::ShellKill)
                .map_err(E::custom),
            CommandType::ShellResize => serde_json::from_value::<CommandShellResizePayload>(value)
                .map(Self::ShellResize)
                .map_err(E::custom),
            _ => Ok(Self::Other(value)),
        }
    }

    fn serialize_for_type<S>(&self, r#type: CommandType) -> Result<serde_json::Value, S::Error>
    where
        S: serde::Serializer,
    {
        match (r#type, self) {
            (CommandType::MessageSubmit, Self::MessageSubmit(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ApprovalApprove, Self::ApprovalApprove(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ApprovalReject, Self::ApprovalReject(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::SessionCreate, Self::SessionCreate(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::GateSignoff, Self::GateSignoff(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::GateOverride, Self::GateOverride(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::GateRevokeOverride, Self::GateRevokeOverride(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::HandoffApprove, Self::HandoffApprove(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::HandoffDispatchLocal, Self::HandoffDispatchLocal(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::HandoffReject, Self::HandoffReject(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::HandoffStatus, Self::HandoffStatus(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::AssessmentRun, Self::AssessmentRun(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::AssessmentFetchReport, Self::AssessmentFetchReport(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::AssessmentReplay, Self::AssessmentReplay(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::AssessmentCancel, Self::AssessmentCancel(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::AssessmentDiff, Self::AssessmentDiff(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ReleaseDeploy, Self::ReleaseDeploy(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ReleasePublish, Self::ReleasePublish(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ReleaseGenerateNotes, Self::ReleaseGenerateNotes(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ShellStart, Self::ShellStart(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ShellInput, Self::ShellInput(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ShellKill, Self::ShellKill(payload)) => {
                serde_json::to_value(payload).map_err(serde::ser::Error::custom)
            }
            (CommandType::ShellResize, Self::ShellResize(payload)) => {
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
pub struct CommandVersion;

impl CommandVersion {
    pub const VALUE: i64 = 1;
}

impl Serialize for CommandVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_i64(Self::VALUE)
    }
}

impl<'de> Deserialize<'de> for CommandVersion {
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
pub struct Command {
    pub id: String,
    pub payload: CommandPayload,
    pub session_id: String,
    pub r#type: CommandType,
    pub v: CommandVersion,
}

#[derive(Deserialize)]
struct CommandRaw {
    id: String,
    payload: serde_json::Value,
    session_id: String,
    #[serde(rename = "type")]
    r#type: CommandType,
    v: CommandVersion,
}

impl<'de> Deserialize<'de> for Command {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = CommandRaw::deserialize(deserializer)?;
        let payload = CommandPayload::deserialize_for_type::<D::Error>(raw.r#type, raw.payload)?;
        Ok(Self {
            id: raw.id,
            payload,
            session_id: raw.session_id,
            r#type: raw.r#type,
            v: raw.v,
        })
    }
}

impl Serialize for Command {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("Command", 5)?;
        state.serialize_field("id", &self.id)?;
        let payload = self.payload.serialize_for_type::<S>(self.r#type)?;
        state.serialize_field("payload", &payload)?;
        state.serialize_field("session_id", &self.session_id)?;
        state.serialize_field("type", &self.r#type)?;
        state.serialize_field("v", &self.v)?;
        state.end()
    }
}
