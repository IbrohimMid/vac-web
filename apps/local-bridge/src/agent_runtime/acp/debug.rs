//! ACP wire debug tap.
//!
//! Captures outgoing requests/responses, incoming notifications, and
//! stderr lines in a bounded ring buffer. When `VAC_WEB_ACP_DEBUG=1`
//! is enabled, the buffer is also mirrored into the session event ring
//! as `acp.debug_message`.

use super::hash::sha256_hex_canonical;
use super::tool_activity::{redact_raw_input, redact_raw_output};
use bridge_core::EventRing;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};

const DEFAULT_BUFFER_CAPACITY: usize = 256;
const PREVIEW_STRING_CAP: usize = 256;
const PREVIEW_DEPTH_CAP: usize = 2;
const PREVIEW_ARRAY_CAP: usize = 8;
const PREVIEW_MARKER: &str = "...[truncated]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpDebugDirection {
    Incoming,
    Outgoing,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpDebugMessageType {
    Request,
    Response,
    Notification,
    Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AcpDebugMessage {
    pub direction: AcpDebugDirection,
    pub message_type: AcpDebugMessageType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    pub params_preview: Value,
    pub params_hash: String,
    pub ts: String,
}

#[derive(Clone)]
struct AcpDebugSessionSink {
    session_id: String,
    ring: Arc<RwLock<EventRing<crate::ws::envelope::ServerEvent>>>,
    broadcast: broadcast::Sender<crate::ws::envelope::ServerEvent>,
}

struct AcpDebugState {
    entries: VecDeque<AcpDebugMessage>,
    sink: Option<AcpDebugSessionSink>,
}

/// Bounded ACP wire recorder. Entries are always retained locally and
/// mirrored to the session event ring when debug is enabled.
pub struct AcpDebugLog {
    enabled: bool,
    capacity: usize,
    state: Mutex<AcpDebugState>,
}

impl AcpDebugLog {
    pub fn new(enabled: bool) -> Arc<Self> {
        Arc::new(Self::with_capacity(enabled, DEFAULT_BUFFER_CAPACITY))
    }

    pub fn with_capacity(enabled: bool, capacity: usize) -> Self {
        Self {
            enabled,
            capacity: capacity.max(1),
            state: Mutex::new(AcpDebugState {
                entries: VecDeque::new(),
                sink: None,
            }),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub async fn attach_session(
        self: &Arc<Self>,
        session_id: String,
        ring: Arc<RwLock<EventRing<crate::ws::envelope::ServerEvent>>>,
        broadcast: broadcast::Sender<crate::ws::envelope::ServerEvent>,
    ) {
        let (sink, snapshot) = {
            let mut state = self.state.lock().await;
            let sink = AcpDebugSessionSink {
                session_id,
                ring,
                broadcast,
            };
            state.sink = Some(sink.clone());
            let snapshot = state.entries.iter().cloned().collect::<Vec<_>>();
            (sink, snapshot)
        };

        if self.enabled {
            for entry in snapshot {
                sink.emit(entry).await;
            }
        }
    }

    pub async fn record_wire_line(&self, direction: AcpDebugDirection, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let entry = build_entry(direction, line);
        let sink = {
            let mut state = self.state.lock().await;
            state.entries.push_back(entry.clone());
            while state.entries.len() > self.capacity {
                state.entries.pop_front();
            }
            if self.enabled {
                state.sink.clone()
            } else {
                None
            }
        };
        if let Some(sink) = sink {
            sink.emit(entry).await;
        }
    }

    pub async fn record_stderr_line(&self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let entry = build_stderr_entry(line);
        let sink = {
            let mut state = self.state.lock().await;
            state.entries.push_back(entry.clone());
            while state.entries.len() > self.capacity {
                state.entries.pop_front();
            }
            if self.enabled {
                state.sink.clone()
            } else {
                None
            }
        };
        if let Some(sink) = sink {
            sink.emit(entry).await;
        }
    }

    pub async fn snapshot(&self) -> Vec<AcpDebugMessage> {
        self.state
            .lock()
            .await
            .entries
            .iter()
            .cloned()
            .collect::<Vec<_>>()
    }
}

impl AcpDebugSessionSink {
    async fn emit(&self, entry: AcpDebugMessage) {
        let ts = entry.ts.clone();
        let event = crate::ws::envelope::ServerEvent {
            seq: 0,
            session_id: self.session_id.clone(),
            event_type: "acp.debug_message".into(),
            payload: json!(entry),
            v: 1,
            ts,
        };
        let seq = {
            let mut ring = self.ring.write().await;
            ring.push(event.clone())
        };
        let mut with_seq = event;
        with_seq.seq = seq;
        let _ = self.broadcast.send(with_seq);
    }
}

fn build_entry(direction: AcpDebugDirection, line: &str) -> AcpDebugMessage {
    let ts = chrono::Utc::now().to_rfc3339();
    match serde_json::from_str::<Value>(line) {
        Ok(Value::Object(obj)) => {
            let method = obj
                .get("method")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let has_id = obj.get("id").cloned();
            let has_method = method.is_some();
            let payload_source = match (has_method, has_id.is_some()) {
                (true, true) => obj.get("params").cloned().unwrap_or(Value::Null),
                (true, false) => obj.get("params").cloned().unwrap_or(Value::Null),
                (false, true) => obj
                    .get("result")
                    .cloned()
                    .or_else(|| obj.get("error").cloned())
                    .unwrap_or(Value::Null),
                (false, false) => Value::Object(obj.clone()),
            };
            let message_type = match (has_method, has_id.is_some()) {
                (true, true) => AcpDebugMessageType::Request,
                (true, false) => AcpDebugMessageType::Notification,
                (false, true) => AcpDebugMessageType::Response,
                (false, false) => AcpDebugMessageType::Notification,
            };
            let params_preview = sanitize_preview(&payload_source);
            let params_hash = sha256_hex_canonical(&payload_source);
            AcpDebugMessage {
                direction,
                message_type,
                method,
                id: has_id,
                params_preview,
                params_hash,
                ts,
            }
        }
        Ok(other) => AcpDebugMessage {
            direction,
            message_type: AcpDebugMessageType::Notification,
            method: None,
            id: None,
            params_preview: sanitize_preview(&other),
            params_hash: sha256_hex_canonical(&other),
            ts,
        },
        Err(_) => build_text_entry(direction, AcpDebugMessageType::Notification, line),
    }
}

fn build_stderr_entry(line: &str) -> AcpDebugMessage {
    build_text_entry(AcpDebugDirection::Stderr, AcpDebugMessageType::Stderr, line)
}

fn build_text_entry(
    direction: AcpDebugDirection,
    message_type: AcpDebugMessageType,
    line: &str,
) -> AcpDebugMessage {
    let ts = chrono::Utc::now().to_rfc3339();
    let preview = truncate_string(&redact_raw_output(line), PREVIEW_STRING_CAP);
    let params_preview = Value::String(preview);
    let params_hash = sha256_hex_canonical(&Value::String(line.to_string()));
    AcpDebugMessage {
        direction,
        message_type,
        method: None,
        id: None,
        params_preview,
        params_hash,
        ts,
    }
}

fn sanitize_preview(value: &Value) -> Value {
    limit_preview(redact_raw_input(value), 0)
}

fn limit_preview(value: Value, depth: usize) -> Value {
    match value {
        Value::String(s) => {
            Value::String(truncate_string(&redact_raw_output(&s), PREVIEW_STRING_CAP))
        }
        Value::Array(arr) => {
            if depth >= PREVIEW_DEPTH_CAP {
                return Value::String(format!("[array; {} items]", arr.len()));
            }
            let len = arr.len();
            let mut out = arr
                .into_iter()
                .take(PREVIEW_ARRAY_CAP)
                .map(|item| limit_preview(item, depth + 1))
                .collect::<Vec<_>>();
            if len > PREVIEW_ARRAY_CAP {
                out.push(Value::String(format!(
                    "{PREVIEW_MARKER} {} more items",
                    len - PREVIEW_ARRAY_CAP
                )));
            }
            Value::Array(out)
        }
        Value::Object(map) => {
            if depth >= PREVIEW_DEPTH_CAP {
                return Value::String(format!("[object; {} keys]", map.len()));
            }
            Value::Object(
                map.into_iter()
                    .map(|(k, v)| (k, limit_preview(v, depth + 1)))
                    .collect(),
            )
        }
        other => other,
    }
}

fn truncate_string(s: &str, cap: usize) -> String {
    if s.len() <= cap {
        return s.to_string();
    }
    let mut end = cap;
    while end < s.len() && !s.is_char_boundary(end) {
        end += 1;
    }
    let mut out = String::with_capacity(end + PREVIEW_MARKER.len());
    out.push_str(&s[..end]);
    out.push_str(PREVIEW_MARKER);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_core::EventRing;
    use tokio::sync::broadcast;

    #[tokio::test]
    async fn records_debug_frames_and_trims_buffer() {
        let log = Arc::new(AcpDebugLog::with_capacity(true, 2));
        log.record_wire_line(
            AcpDebugDirection::Outgoing,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}"#,
        )
        .await;
        log.record_stderr_line("token=sk-test-secret").await;
        log.record_wire_line(
            AcpDebugDirection::Incoming,
            r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#,
        )
        .await;

        let snapshot = log.snapshot().await;
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].direction, AcpDebugDirection::Stderr);
        assert_eq!(snapshot[1].message_type, AcpDebugMessageType::Response);
        assert_eq!(snapshot[1].method.as_deref(), None);
    }

    #[tokio::test]
    async fn emits_debug_events_when_attached() {
        let log = Arc::new(AcpDebugLog::with_capacity(true, 4));
        let ring = Arc::new(RwLock::new(EventRing::new(16)));
        let (tx, mut rx) = broadcast::channel(16);
        log.attach_session("sess_1".into(), Arc::clone(&ring), tx)
            .await;

        log.record_wire_line(
            AcpDebugDirection::Outgoing,
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp/project","mcpServers":[]}}"#,
        )
        .await;

        let event = rx.recv().await.expect("debug event");
        assert_eq!(event.event_type, "acp.debug_message");
        assert_eq!(event.session_id, "sess_1");
        assert_eq!(event.payload["direction"], json!("outgoing"));
        assert_eq!(event.payload["message_type"], json!("request"));
        assert_eq!(event.payload["method"], json!("session/new"));
        assert!(event.payload["params_hash"].as_str().unwrap().len() >= 32);
    }
}
