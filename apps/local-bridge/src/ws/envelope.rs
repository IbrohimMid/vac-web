//! Minimal envelope types used on the WS wire. Full discriminated union lives in
//! `packages/protocol-rs`; here we deserialize the header fields we route on.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Incoming {
    Hello(HelloFrame),
    Command(ClientCommand),
    Replay(ReplayRequest),
}

#[derive(Debug, Clone, Deserialize)]
pub struct HelloFrame {
    pub r#type: String, // "hello"
    #[serde(default)]
    pub protocol_version: u32,
    #[serde(default)]
    pub auth: Option<AuthFrame>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthFrame {
    pub access_token: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClientCommand {
    pub id: String,
    pub session_id: String,
    #[serde(rename = "type")]
    pub cmd_type: String,
    #[serde(default)]
    pub payload: Value,
    pub v: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReplayRequest {
    pub r#type: String, // "replay.request"
    pub session_id: String,
    pub last_event_id: u64,
}

/// Event frame emitted by bridge → client.
#[derive(Debug, Clone, Serialize)]
pub struct ServerEvent {
    pub seq: u64,
    pub session_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
    pub v: u32,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerAck {
    #[serde(rename = "ackOf")]
    pub ack_of: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
}

/// Lightweight per-agent advertisement included in the welcome frame so
/// the cockpit can render a provider picker without a separate HTTP
/// roundtrip. Only enabled agents are surfaced; the bridge marks exactly
/// one entry as `default = true` (matching `default_agent`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AvailableAgent {
    pub id: String,
    pub label: String,
    pub kind: &'static str,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WelcomeFrame {
    #[serde(rename = "type")]
    pub frame_type: &'static str,
    pub protocol_version: u32,
    pub bridge_version: &'static str,
    pub capabilities: Vec<&'static str>,
    /// Enabled agents the cockpit may pick when calling `session.create`.
    /// Empty when the bridge runs with the legacy single-binary shim.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_agents: Vec<AvailableAgent>,
}

impl WelcomeFrame {
    pub fn new() -> Self {
        Self {
            frame_type: "welcome",
            protocol_version: 1,
            bridge_version: env!("CARGO_PKG_VERSION"),
            capabilities: vec!["session", "message", "approval", "replay"],
            available_agents: Vec::new(),
        }
    }

    /// Build a welcome frame from the live agent runtime registry.
    /// Disabled agents are filtered out so the cockpit only sees agents
    /// it can actually spawn. The default agent is marked with
    /// `default = true`.
    pub fn with_registry(registry: &crate::agent_runtime::AgentRuntimeRegistry) -> Self {
        let default_id = &registry.default_agent().id;
        let available_agents = registry
            .list_enabled()
            .into_iter()
            .map(|a| AvailableAgent {
                id: a.id.clone(),
                label: a.label.clone(),
                kind: a.kind.as_str(),
                default: &a.id == default_id,
            })
            .collect();
        Self {
            available_agents,
            ..Self::new()
        }
    }
}

impl Default for WelcomeFrame {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::{AgentRuntimeRegistry, AgentsConfig, ConfigSource};
    use std::path::Path;

    fn registry_from_toml(src: &str) -> AgentRuntimeRegistry {
        let cfg = AgentsConfig::from_toml_str(src, Path::new("<test>")).expect("parse");
        AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
    }

    #[test]
    fn welcome_with_registry_marks_default_and_lists_enabled() {
        // Two enabled ACP agents + one explicitly disabled. The welcome
        // must surface only the enabled pair and tag exactly one as
        // `default`.
        let src = r#"
default_agent = "claude-acp"

[agents.claude-acp]
kind = "acp"
label = "Claude"
command = "npx"
args = ["-y", "@agentclientprotocol/claude-agent-acp"]
enabled = true

[agents.gemini-acp]
kind = "acp"
label = "Gemini"
command = "gemini"
args = ["--acp"]
enabled = true

[agents.disabled-thing]
kind = "mock"
label = "Off"
command = "nope"
args = []
enabled = false
"#;
        let registry = registry_from_toml(src);
        let welcome = WelcomeFrame::with_registry(&registry);
        let ids: Vec<&str> = welcome
            .available_agents
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        assert!(ids.contains(&"claude-acp"), "claude present: {ids:?}");
        assert!(ids.contains(&"gemini-acp"), "gemini present: {ids:?}");
        assert!(
            !ids.contains(&"disabled-thing"),
            "disabled filtered: {ids:?}"
        );
        let defaults: Vec<&str> = welcome
            .available_agents
            .iter()
            .filter(|a| a.default)
            .map(|a| a.id.as_str())
            .collect();
        assert_eq!(defaults, vec!["claude-acp"], "exactly one default");
        // Each entry carries a stable `kind` discriminant the FE can
        // render as a badge.
        for a in &welcome.available_agents {
            assert_eq!(a.kind, "acp");
            assert!(!a.label.is_empty());
        }
    }

    #[test]
    fn welcome_with_registry_serializes_with_available_agents_field() {
        // Wire-shape regression: the FE depends on the `available_agents`
        // key being a JSON array of `{id,label,kind,default}` objects.
        let src = r#"
default_agent = "only"

[agents.only]
kind = "mock"
label = "Only"
command = "only"
args = []
enabled = true
"#;
        let registry = registry_from_toml(src);
        let welcome = WelcomeFrame::with_registry(&registry);
        let json = serde_json::to_value(&welcome).expect("serialize");
        assert_eq!(json["type"], "welcome");
        let agents = json["available_agents"].as_array().expect("array");
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0]["id"], "only");
        assert_eq!(agents[0]["label"], "Only");
        assert_eq!(agents[0]["kind"], "mock");
        assert_eq!(agents[0]["default"], true);
    }

    #[test]
    fn welcome_new_omits_available_agents_when_empty() {
        // Legacy `WelcomeFrame::new()` callers (single-binary shim,
        // tests) must not regress: the field is absent from the wire
        // when no registry is plumbed in.
        let json = serde_json::to_value(WelcomeFrame::new()).expect("serialize");
        assert!(
            json.get("available_agents").is_none(),
            "field skipped when empty: {json}"
        );
    }
}
