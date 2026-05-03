//! ActionSpec catalog emitted on session.ready as `system.capabilities` event.
//!
//! v1 snapshot. Extends as features land in Phases 3+.
//!
//! Slice 27 (wiring.config_capabilities_control_plane) contract:
//! every ActionSpec id MUST be present in `crate::generated::command_catalog`
//! with status `Implemented`. The unit test at the bottom enforces this so
//! the YAML control-plane manifest cannot drift away from runtime authority.

use serde::Serialize;
use serde_json::{json, Value};

#[cfg(test)]
use crate::generated::command_catalog::{self, CommandStatus};

#[derive(Debug, Clone, Serialize)]
pub struct ActionSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub group: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keybinding: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slash_alias: Option<&'static str>,
    pub palette_visible: bool,
    pub required_capabilities: &'static [&'static str],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_when: Option<&'static str>,
}

pub fn v1_actions() -> Vec<ActionSpec> {
    vec![
        ActionSpec {
            id: "session.close",
            label: "Close session",
            description: "Terminate the active session.",
            group: "Session",
            keybinding: None,
            slash_alias: Some("/close"),
            palette_visible: true,
            required_capabilities: &[],
            available_when: Some("session.open"),
        },
        ActionSpec {
            id: "message.cancel_stream",
            label: "Cancel stream",
            description: "Stop the current assistant response.",
            group: "Session",
            keybinding: Some("Escape"),
            slash_alias: Some("/cancel"),
            palette_visible: true,
            required_capabilities: &[],
            available_when: Some("session.streaming"),
        },
        ActionSpec {
            id: "system.ping",
            label: "Ping bridge",
            description: "Health check — returns pong from engine.",
            group: "System",
            keybinding: None,
            slash_alias: Some("/ping"),
            palette_visible: true,
            required_capabilities: &[],
            available_when: None,
        },
        ActionSpec {
            id: "session.list",
            label: "List sessions",
            description: "Show all active sessions.",
            group: "Session",
            keybinding: None,
            slash_alias: Some("/sessions"),
            palette_visible: true,
            required_capabilities: &[],
            available_when: None,
        },
    ]
}

pub fn bundled_workflows() -> Value {
    use crate::workflows::WorkflowRegistry;
    let default_id = WorkflowRegistry::default_build_spec_id();
    let reg = WorkflowRegistry::global();
    let ordered = [
        "build.observe-tools",
        "build.full-cockpit",
        "build.approval-gated-edit",
        "build.basic",
        "assess.report",
        "handoff.package",
    ];
    let list: Vec<Value> = ordered
        .iter()
        .filter_map(|id| {
            reg.get(id).map(|spec| {
                json!({
                    "id": id,
                    "name": spec.metadata.name,
                    "default": *id == default_id,
                })
            })
        })
        .collect();
    json!(list)
}

pub fn capabilities_payload() -> Value {
    json!({
        "actions": v1_actions(),
        "features": ["session", "message", "approval", "replay"],
        "workflows": bundled_workflows(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Slice 27 acceptance: every advertised capability ActionSpec must
    /// resolve to an implemented entry in the generated command catalog.
    /// If this fires, either:
    ///   - mark the action as implemented in config/control-plane/command-manifest.yaml
    ///     (and re-run scripts/codegen-command-catalog.mjs), OR
    ///   - remove the ActionSpec from v1_actions() until the executor lands.
    #[test]
    fn every_action_id_is_implemented_in_catalog() {
        for spec in v1_actions() {
            let entry = command_catalog::lookup(spec.id).unwrap_or_else(|| {
                panic!(
                    "action id '{}' missing from generated command catalog",
                    spec.id
                )
            });
            assert_eq!(
                entry.status,
                CommandStatus::Implemented,
                "action id '{}' has catalog status {:?}, expected Implemented",
                spec.id,
                entry.status,
            );
        }
    }

    #[test]
    fn capabilities_payload_serializes_actions_features_workflows() {
        let v = capabilities_payload();
        let obj = v.as_object().expect("capabilities is an object");
        assert!(obj.contains_key("actions"));
        assert!(obj.contains_key("features"));
        assert!(obj.contains_key("workflows"));
    }
}
