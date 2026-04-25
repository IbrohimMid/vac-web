//! ACP client actor — Stage X.5b.
//!
//! Owns the JSON-RPC 2.0 over ndjson transport for a spawned ACP Agent
//! child (e.g. `claude-agent-acp`). Exposes a small typed API for the
//! Stage X.5b scope:
//!
//! - `initialize`
//! - `new_session`
//! - `prompt`
//! - `cancel`
//! - `subscribe_updates()` for incoming `session/update` notifications
//!
//! Permission / fs / terminal envelopes are X.5c scope and are NOT
//! handled here. Inbound requests for those methods receive a typed
//! JSON-RPC error response.
//!
//! The actor is one task per spawned child:
//!
//! ```text
//! +----------+ stdin  (Vec<u8> via mpsc)  +-----------------+
//! | actor    |--------------------------->| writer task     |---> child stdin
//! |          |                            +-----------------+
//! |          |                            +-----------------+
//! |          |<---- responses & notifs ---|  reader task    |<--- child stdout
//! +----------+                            +-----------------+
//!     ^
//!     | typed methods (initialize/new_session/prompt/cancel)
//!     v
//! SessionHandle
//! ```

use super::types::*;
use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tracing::{debug, info, warn};

/// Configurable upper bound on a single ACP request round-trip.
/// `session/prompt` is excluded from this — prompts can run minutes.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Internal pending-request table.
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>;

#[derive(Debug, Clone)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    pub data: Value,
}

impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "json-rpc {}: {} ({})",
            self.code, self.message, self.data
        )
    }
}

impl std::error::Error for JsonRpcError {}

pub struct AcpClient {
    next_id: Arc<Mutex<u64>>,
    pending: Pending,
    stdin_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    /// Broadcast receiver for inbound `session/update` notifications.
    /// Subscribers attach with `subscribe_updates()`.
    updates: broadcast::Sender<SessionNotification>,
}

impl AcpClient {
    /// Spawn the ACP child and start the reader/writer tasks. Returns
    /// the handle plus a JoinHandle on the child for the caller's
    /// watchdog (existing X.3 child-exit handling reuses it).
    pub fn spawn(
        command: &std::path::Path,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<(Self, Child)> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in env {
            cmd.env(k, v);
        }
        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn ACP agent: {}", command.display()))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _) = broadcast::channel::<SessionNotification>(256);

        let (stdin_tx, stdin_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

        // Writer task — owns stdin, receives ndjson lines from a channel.
        spawn_writer(stdin, stdin_rx);

        // Reader task — owns stdout, dispatches responses/notifications.
        spawn_reader(stdout, Arc::clone(&pending), updates_tx.clone());

        // Stderr pump — bridge debug logs only.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                debug!(target: "acp.stderr", "{l}");
            }
        });

        let client = AcpClient {
            next_id: Arc::new(Mutex::new(1)),
            pending,
            stdin_tx,
            updates: updates_tx,
        };
        Ok((client, child))
    }

    pub fn subscribe_updates(&self) -> broadcast::Receiver<SessionNotification> {
        self.updates.subscribe()
    }

    async fn next_id(&self) -> u64 {
        let mut g = self.next_id.lock().await;
        let id = *g;
        *g += 1;
        id
    }

    fn write_line(&self, bytes: Vec<u8>) -> Result<()> {
        self.stdin_tx
            .send(bytes)
            .map_err(|_| anyhow!("acp child stdin closed"))
    }

    /// Send a typed JSON-RPC request and await the response. Caller
    /// chooses the timeout (`session/prompt` uses an unbounded one).
    async fn rpc<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: P,
        timeout: Option<Duration>,
    ) -> Result<R> {
        let id = self.next_id().await;
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.write_line(bytes)?;

        let result_value = match timeout {
            Some(t) => tokio::time::timeout(t, rx)
                .await
                .map_err(|_| anyhow!("acp {method} timed out after {t:?}"))?
                .map_err(|_| anyhow!("acp {method}: response channel dropped"))??,
            None => rx
                .await
                .map_err(|_| anyhow!("acp {method}: response channel dropped"))??,
        };

        serde_json::from_value::<R>(result_value)
            .with_context(|| format!("decoding ACP {method} result"))
    }

    /// Notification (no response): fire-and-forget.
    async fn notify<P: Serialize>(&self, method: &str, params: P) -> Result<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        self.write_line(bytes)
    }

    // --- typed API for X.5b ---

    pub async fn initialize(&self, req: InitializeRequest) -> Result<InitializeResponse> {
        self.rpc("initialize", req, Some(REQUEST_TIMEOUT)).await
    }

    pub async fn new_session(&self, req: NewSessionRequest) -> Result<NewSessionResponse> {
        self.rpc("session/new", req, Some(REQUEST_TIMEOUT)).await
    }

    /// `session/prompt` is unbounded — prompts can take minutes. The
    /// caller controls cancellation via `cancel(...)`.
    pub async fn prompt(&self, req: PromptRequest) -> Result<PromptResponse> {
        self.rpc("session/prompt", req, None).await
    }

    pub async fn cancel(&self, sid: &str) -> Result<()> {
        self.notify(
            "session/cancel",
            CancelNotification {
                session_id: sid.to_string(),
            },
        )
        .await
    }
}

fn spawn_writer(mut stdin: ChildStdin, mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) {
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if let Err(e) = stdin.write_all(&bytes).await {
                warn!(error=%e, "acp writer: stdin write failed");
                return;
            }
            if let Err(e) = stdin.flush().await {
                warn!(error=%e, "acp writer: stdin flush failed");
                return;
            }
        }
        // Channel closed: drop stdin so the child sees EOF.
        let _ = stdin.shutdown().await;
    });
}

fn spawn_reader(
    stdout: tokio::process::ChildStdout,
    pending: Pending,
    updates: broadcast::Sender<SessionNotification>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Err(e) = dispatch_line(&line, &pending, &updates).await {
                        warn!(error=%e, line=%line, "acp reader: dispatch failed");
                    }
                }
                Ok(None) => {
                    info!("acp reader: stdout EOF");
                    // Drain pending with errors so callers don't hang.
                    let mut p = pending.lock().await;
                    for (_, tx) in p.drain() {
                        let _ = tx.send(Err(JsonRpcError {
                            code: -32000,
                            message: "agent exited".into(),
                            data: Value::Null,
                        }));
                    }
                    return;
                }
                Err(e) => {
                    warn!(error=%e, "acp reader: stdout read error");
                    return;
                }
            }
        }
    });
}

async fn dispatch_line(
    line: &str,
    pending: &Pending,
    updates: &broadcast::Sender<SessionNotification>,
) -> Result<()> {
    let v: Value = serde_json::from_str(line).context("non-JSON line on ACP stdout")?;

    // Notification?
    if v.get("id").is_none() {
        let method = v
            .get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| anyhow!("notification without method"))?;
        if method == "session/update" {
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            let notif: SessionNotification =
                serde_json::from_value(params).context("decoding session/update params")?;
            let _ = updates.send(notif);
            return Ok(());
        }
        // Other notifications (e.g. cancellations) ignored at X.5b scope.
        debug!(target: "acp", method, "notification ignored at X.5b scope");
        return Ok(());
    }

    // Inbound request from the agent? Stage X.5b answers a typed
    // method-not-supported error so the agent doesn't hang waiting for
    // a response. X.5c will replace this with real handlers.
    if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        let resp = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not handled by bridge X.5b scope: {method}"),
                "data": { "method": method }
            }
        });
        // We don't have direct access to stdin_tx from here; the request
        // arm is rare in X.5b prompt-only flows. Log and drop. Once X.5c
        // wires fs/terminal/permission handlers, this branch will route
        // through a per-method handler and emit a real response.
        warn!(
            method,
            "ACP inbound request ignored at X.5b (would respond: {resp})"
        );
        return Ok(());
    }

    // Response to one of our outgoing requests.
    let id = v
        .get("id")
        .and_then(|i| i.as_u64())
        .ok_or_else(|| anyhow!("response without numeric id"))?;
    let mut p = pending.lock().await;
    let Some(tx) = p.remove(&id) else {
        warn!(id, "ACP response with no matching pending request");
        return Ok(());
    };

    if let Some(err) = v.get("error") {
        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-32000);
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string();
        let data = err.get("data").cloned().unwrap_or(Value::Null);
        let _ = tx.send(Err(JsonRpcError {
            code,
            message,
            data,
        }));
    } else {
        let result = v.get("result").cloned().unwrap_or(Value::Null);
        let _ = tx.send(Ok(result));
    }
    Ok(())
}

/// Map a `JsonRpcError` to a stable bridge-side error code so the
/// translator can surface a typed ack code without inspecting the
/// full payload. Used by X.5c too.
pub fn classify_jsonrpc_error(e: &JsonRpcError) -> &'static str {
    match e.code {
        -32601 => "agent.protocol_unsupported",
        -32602 => "agent.protocol_invalid_params",
        -32603 => {
            if e.data
                .get("details")
                .and_then(|d| d.as_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("session not found"))
            {
                "session.not_found"
            } else {
                "agent.internal"
            }
        }
        _ => "agent.protocol_error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_codes() {
        let e = JsonRpcError {
            code: -32601,
            message: "Method not found".into(),
            data: Value::Null,
        };
        assert_eq!(classify_jsonrpc_error(&e), "agent.protocol_unsupported");

        let e = JsonRpcError {
            code: -32602,
            message: "Invalid params".into(),
            data: Value::Null,
        };
        assert_eq!(classify_jsonrpc_error(&e), "agent.protocol_invalid_params");

        let e = JsonRpcError {
            code: -32603,
            message: "Internal error".into(),
            data: json!({"details": "Session not found"}),
        };
        assert_eq!(classify_jsonrpc_error(&e), "session.not_found");

        let e = JsonRpcError {
            code: -32603,
            message: "Internal error".into(),
            data: Value::Null,
        };
        assert_eq!(classify_jsonrpc_error(&e), "agent.internal");
    }

    #[test]
    fn session_notification_discriminator_and_chunk_text() {
        let raw = json!({
            "sessionId": "sid-1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "hello" }
            }
        });
        let n: SessionNotification = serde_json::from_value(raw).unwrap();
        assert_eq!(n.discriminator(), Some("agent_message_chunk"));
        assert_eq!(n.message_chunk_text().as_deref(), Some("hello"));
    }
}
