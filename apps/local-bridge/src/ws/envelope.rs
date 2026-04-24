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

#[derive(Debug, Clone, Serialize)]
pub struct WelcomeFrame {
    #[serde(rename = "type")]
    pub frame_type: &'static str,
    pub protocol_version: u32,
    pub bridge_version: &'static str,
    pub capabilities: Vec<&'static str>,
}

impl WelcomeFrame {
    pub fn new() -> Self {
        Self {
            frame_type: "welcome",
            protocol_version: 1,
            bridge_version: env!("CARGO_PKG_VERSION"),
            capabilities: vec!["session", "message", "approval", "replay"],
        }
    }
}

impl Default for WelcomeFrame {
    fn default() -> Self {
        Self::new()
    }
}
