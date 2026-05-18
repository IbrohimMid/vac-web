// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/action_spec.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer_visible: Option<bool>,
    pub group: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keybinding: Option<String>,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_ui: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_capabilities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slash_alias: Option<String>,
}
