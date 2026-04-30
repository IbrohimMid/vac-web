//! Minimal hand-rolled types for the slice of ACP that Stage X.5b needs.
//!
//! Schema source: `@agentclientprotocol/sdk@0.20.0`'s
//! `schema/schema.json`. We hand-roll only the messages used by
//! `initialize`, `session/new`, `session/prompt`, `session/cancel`,
//! and the inbound `session/update` notification. Everything else
//! (permissions, fs, terminal, elicitation, providers, NES, and the
//! rest of `session/*`) is X.5c+ scope.
//!
//! `_meta` fields and any field whose schema we don't actively read
//! stay as `serde_json::Value` so vendor extensions (e.g.
//! `agentCapabilities._meta.claudeCode.promptQueueing`) pass through
//! intact. Type-strategy decision recorded in
//! `docs/plans/stage-x5a-acp-client-design.md` §8.3.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// --- initialize ---

#[derive(Debug, Clone, Serialize)]
pub struct InitializeRequest {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "clientCapabilities")]
    pub client_capabilities: ClientCapabilities,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientCapabilities {
    pub fs: FsClientCapabilities,
    pub terminal: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthClientCapabilities {
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsClientCapabilities {
    #[serde(rename = "readTextFile")]
    pub read_text_file: bool,
    #[serde(rename = "writeTextFile")]
    pub write_text_file: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    pub protocol_version: u32,
    pub agent_capabilities: Value,
    #[serde(default)]
    pub agent_info: Value,
    #[serde(default)]
    pub auth_methods: Value,
    #[serde(default, rename = "_meta")]
    pub meta: Value,
}

// --- session/new ---

#[derive(Debug, Clone, Serialize)]
pub struct NewSessionRequest {
    pub cwd: String,
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionResponse {
    pub session_id: String,
    #[serde(default)]
    pub models: Value,
    #[serde(default)]
    pub modes: Value,
    #[serde(default)]
    pub config_options: Value,
    #[serde(default, rename = "_meta")]
    pub meta: Value,
}

// --- session/load (Stage X6 batch 4-1) ---
//
// `session/load` resumes a previously persisted ACP session by
// re-establishing it on the agent side and replaying its history via
// `session/update` notifications **before** the response resolves.
// See ACP schema (`@agentclientprotocol/sdk` >= 0.20.x):
// https://agentclientprotocol.com/protocol/session-setup#loading-sessions
//
// Adapter capability discovery: the bridge SHOULD only attempt this
// call when `initialize.agentCapabilities.loadSession == true`. If we
// try it anyway, well-behaved adapters return `-32601` (method not
// found); we map that to `LoadSessionUnsupported` in the bridge so
// the resume FSM can fall back to replay-only.
//
// Adapter-side rejection (e.g. unknown sessionId, bad cwd) comes back
// as `-32602` (invalid params) which we map to `LoadSessionRejected`.

#[derive(Debug, Clone, Serialize)]
pub struct LoadSessionRequest {
    /// The agent-side session id we want to re-attach to. Must match
    /// what the agent emitted from a prior `session/new`.
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Project working directory for the resumed session. ACP requires
    /// this even on load so the agent can re-anchor relative paths.
    pub cwd: String,
    /// MCP servers to (re)attach. May differ from the original list
    /// (e.g. user added/removed servers). Empty array is valid.
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionResponse {
    /// Optional model list snapshot, mirrored from `session/new`.
    #[serde(default)]
    pub models: Value,
    /// Optional mode list snapshot.
    #[serde(default)]
    pub modes: Value,
    /// Optional config-options snapshot.
    #[serde(default)]
    pub config_options: Value,
    /// Vendor metadata pass-through (e.g. claude `_meta`).
    #[serde(default, rename = "_meta")]
    pub meta: Value,
}

// --- session/prompt ---

#[derive(Debug, Clone, Serialize)]
pub struct PromptRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub prompt: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    pub stop_reason: String,
    #[serde(default)]
    pub usage: Value,
    #[serde(default, rename = "_meta")]
    pub meta: Value,
}

// --- authenticate ---

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticateRequest {
    /// Identifier of the auth method advertised by `initialize.authMethods`.
    /// E.g. `"claude-login"` for the OAuth-based Claude Pro/Max login.
    #[serde(rename = "methodId")]
    pub method_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateResponse {
    /// Adapter-defined status field. Optional in the ACP schema; we keep
    /// it as a passthrough JSON value so vendor extensions ride along.
    #[serde(default)]
    pub status: Value,
    #[serde(default, rename = "_meta")]
    pub meta: Value,
}

// --- session/cancel (notification) ---

#[derive(Debug, Clone, Serialize)]
pub struct CancelNotification {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct AcpToolCall {
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub struct AcpToolCallUpdate {
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AcpPlanEntry {
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub enum AcpSessionUpdate {
    AgentMessageChunk { text: String },
    AgentThoughtChunk { text: String },
    ToolCall { tool_call: AcpToolCall },
    ToolCallUpdate { update: AcpToolCallUpdate },
    Plan { entries: Vec<AcpPlanEntry> },
    AvailableCommandsUpdate { commands: Vec<Value> },
    CurrentModeUpdate { mode_id: String },
    ConfigOptionsUpdate { options: Vec<Value> },
    Unknown { discriminator: String, raw: Value },
}

// --- session/update (notification, agent → client) ---

#[derive(Debug, Clone, Deserialize)]
pub struct SessionNotification {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub update: Value,
}

/// Convenience accessors for the SessionUpdate discriminator. Kept as
/// helpers rather than a typed enum because X.5b only needs three
/// variants reliably; the rest pass through as raw JSON for X.5c.
impl SessionNotification {
    pub fn discriminator(&self) -> Option<&str> {
        self.update.get("sessionUpdate").and_then(|v| v.as_str())
    }

    /// Parse the ACP `session/update` discriminator into the bridge's
    /// typed-but-lossless update enum. Every known variant keeps the raw
    /// vendor payload reachable either through the original
    /// [`SessionNotification::update`] field or a wrapper, and unknown
    /// variants are preserved verbatim.
    pub fn parsed_update(&self) -> AcpSessionUpdate {
        let discriminator = self.discriminator().unwrap_or("unknown").to_string();
        match discriminator.as_str() {
            "agent_message_chunk" => AcpSessionUpdate::AgentMessageChunk {
                text: self.message_chunk_text().unwrap_or_default(),
            },
            "agent_thought_chunk" => AcpSessionUpdate::AgentThoughtChunk {
                text: self.message_chunk_text().unwrap_or_default(),
            },
            "tool_call" => AcpSessionUpdate::ToolCall {
                tool_call: AcpToolCall {
                    raw: self.update.clone(),
                },
            },
            "tool_call_update" => AcpSessionUpdate::ToolCallUpdate {
                update: AcpToolCallUpdate {
                    raw: self.update.clone(),
                },
            },
            "plan" | "plan_update" => AcpSessionUpdate::Plan {
                entries: self.plan_entries(),
            },
            "available_commands_update" => AcpSessionUpdate::AvailableCommandsUpdate {
                commands: self
                    .update
                    .get("commands")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default(),
            },
            "current_mode_update" => AcpSessionUpdate::CurrentModeUpdate {
                mode_id: self
                    .update
                    .get("modeId")
                    .or_else(|| self.update.get("mode_id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
            },
            "config_options_update" => AcpSessionUpdate::ConfigOptionsUpdate {
                options: self
                    .update
                    .get("options")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default(),
            },
            _ => AcpSessionUpdate::Unknown {
                discriminator,
                raw: self.update.clone(),
            },
        }
    }

    /// For `agent_message_chunk` and `agent_thought_chunk`, extract the
    /// text content as a single concatenated string. Returns `None` if
    /// the variant doesn't carry chunk content.
    pub fn message_chunk_text(&self) -> Option<String> {
        let content = self.update.get("content")?;
        // Per ACP, content is a single ContentBlock (not array) for
        // chunk variants. Pull the text field if present.
        if let Some(text) = content.get("text").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
        // Fallback: serialize whatever's there so we don't drop data.
        Some(content.to_string())
    }

    fn plan_entries(&self) -> Vec<AcpPlanEntry> {
        let entries = self
            .update
            .get("entries")
            .or_else(|| self.update.get("plan").and_then(|p| p.get("entries")))
            .or_else(|| self.update.get("todos"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        entries
            .into_iter()
            .map(|raw| AcpPlanEntry { raw })
            .collect()
    }
}
