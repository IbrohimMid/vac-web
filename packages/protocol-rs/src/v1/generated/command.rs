// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/command.schema.json

use serde::{Deserialize, Serialize};

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
    #[serde(rename = "extensions.list")]
    ExtensionsList,
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
    #[serde(rename = "plan.approve")]
    PlanApprove,
    #[serde(rename = "plan.edit")]
    PlanEdit,
    #[serde(rename = "plan.open")]
    PlanOpen,
    #[serde(rename = "plan.reject")]
    PlanReject,
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
    #[serde(rename = "workbench.invoke")]
    WorkbenchInvoke,
    #[serde(rename = "workbench.select_tab")]
    WorkbenchSelectTab,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub payload: serde_json::Value,
    pub session_id: String,
    #[serde(rename = "type")]
    pub r#type: CommandType,
    pub v: CommandVersion,
}
