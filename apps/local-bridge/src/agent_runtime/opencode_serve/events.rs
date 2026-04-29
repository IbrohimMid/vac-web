//! Typed events emitted by `opencode acp`/`opencode serve` over `/event` SSE.
//!
//! The variants are derived from observed payloads documented in
//! `.ci-logs/opencode-serve-api.md`. Field aliases (`sessionID`/`session_id`,
//! `parentID`/`parent_id`, `toolCallID`/`tool_call_id`/`id`) are accepted
//! defensively since opencode's SSE shape has shifted between releases.
//! Unknown frames fall through to [`OpencodeServeEvent::Other`] so a future
//! opencode version cannot crash the subscriber.

use serde::Deserialize;
use serde_json::Value;

/// Decoded SSE event from opencode's HTTP API.
#[derive(Debug, Clone, PartialEq)]
pub enum OpencodeServeEvent {
    /// Initial handshake frame the server emits on connect.
    ServerConnected,
    /// A session row was created or updated. `parent_id` is `Some` when
    /// this is a sub-agent (Task tool) session spawned by another session.
    SessionUpdated {
        session_id: String,
        parent_id: Option<String>,
    },
    /// Streaming message-part update — text/tool deltas during a turn.
    MessagePartUpdated {
        session_id: String,
        message_id: String,
        part: Value,
    },
    /// A tool call started executing inside the given session.
    ToolCallStarted {
        session_id: String,
        tool_call_id: String,
        name: String,
        input: Value,
    },
    /// A tool call finished (success or error). `status` mirrors the raw
    /// payload (`completed`/`error`/etc).
    ToolCallCompleted {
        session_id: String,
        tool_call_id: String,
        output: Value,
        status: String,
    },
    /// Frame whose `type` we don't model yet. Kept verbatim so a debug
    /// subscriber can log it without losing fidelity.
    Other {
        event_type: String,
        properties: Value,
    },
}

/// Subset of `GET /session` rows we care about.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct SessionMeta {
    pub id: String,
    #[serde(default, alias = "parentID")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawSseEvent {
    #[serde(rename = "type")]
    type_: String,
    #[serde(default)]
    properties: Value,
}

impl OpencodeServeEvent {
    /// Parse one SSE `data:` JSON payload into a typed event.
    pub fn from_json_str(payload: &str) -> Result<Self, serde_json::Error> {
        let raw: RawSseEvent = serde_json::from_str(payload)?;
        Ok(Self::from_raw(raw))
    }

    fn from_raw(raw: RawSseEvent) -> Self {
        let p = &raw.properties;
        match raw.type_.as_str() {
            "server.connected" => Self::ServerConnected,

            "session.updated" | "session.created" => {
                // opencode wraps the row under `info` in some versions and
                // inlines fields in others — accept both.
                let info = p.get("info").unwrap_or(p);
                Self::SessionUpdated {
                    session_id: str_field(info, &["id", "sessionID", "session_id"]),
                    parent_id: opt_str_field(info, &["parentID", "parent_id"]),
                }
            }

            "message.part.updated" | "message.updated" => {
                let part = p.get("part").cloned().unwrap_or_else(|| p.clone());
                let session_id = str_field(&part, &["sessionID", "session_id"]);
                let message_id = str_field(&part, &["messageID", "message_id"]);
                Self::MessagePartUpdated {
                    session_id,
                    message_id,
                    part,
                }
            }

            "tool.call.started" | "tool_call.started" => Self::ToolCallStarted {
                session_id: str_field(p, &["sessionID", "session_id"]),
                tool_call_id: str_field(p, &["toolCallID", "tool_call_id", "id"]),
                name: str_field(p, &["name", "tool"]),
                input: p.get("input").cloned().unwrap_or(Value::Null),
            },

            "tool.call.completed" | "tool_call.completed" | "tool.call.error" => {
                Self::ToolCallCompleted {
                    session_id: str_field(p, &["sessionID", "session_id"]),
                    tool_call_id: str_field(p, &["toolCallID", "tool_call_id", "id"]),
                    output: p.get("output").cloned().unwrap_or(Value::Null),
                    status: p
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or(if raw.type_.ends_with("error") {
                            "error"
                        } else {
                            "completed"
                        })
                        .to_string(),
                }
            }

            other => Self::Other {
                event_type: other.to_string(),
                properties: raw.properties,
            },
        }
    }
}

fn str_field(value: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = value.get(*k).and_then(|v| v.as_str()) {
            return s.to_string();
        }
    }
    String::new()
}

fn opt_str_field(value: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = value.get(*k).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}
