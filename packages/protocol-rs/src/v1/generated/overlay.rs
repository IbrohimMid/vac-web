// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/overlay.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Overlay {
    #[serde(rename = "command_palette")]
    CommandPalette,
    #[serde(rename = "file_search")]
    FileSearch,
    #[serde(rename = "model_switcher")]
    ModelSwitcher,
    #[serde(rename = "profile_switcher")]
    ProfileSwitcher,
    #[serde(rename = "rulebook_switcher")]
    RulebookSwitcher,
    #[serde(rename = "isolation_switcher")]
    IsolationSwitcher,
    #[serde(rename = "shell_drawer")]
    ShellDrawer,
    #[serde(rename = "approval_inspector")]
    ApprovalInspector,
    #[serde(rename = "diff_viewer")]
    DiffViewer,
    #[serde(rename = "handoff_builder")]
    HandoffBuilder,
    #[serde(rename = "gate_detail")]
    GateDetail,
    #[serde(rename = "assessment_report")]
    AssessmentReport,
    #[serde(rename = "connector_manager")]
    ConnectorManager,
    #[serde(rename = "override_dialog")]
    OverrideDialog,
    #[serde(rename = "signoff_dialog")]
    SignoffDialog,
    #[serde(rename = "confirm")]
    Confirm,
    #[serde(rename = "ask_user")]
    AskUser,
    #[serde(rename = "share_session")]
    ShareSession,
}
