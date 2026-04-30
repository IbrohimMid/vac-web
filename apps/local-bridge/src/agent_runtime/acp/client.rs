//! ACP client actor — Stage X.5b + X.5c.
//!
//! Owns the JSON-RPC 2.0 over ndjson transport for a spawned ACP Agent
//! child (e.g. `claude-agent-acp`). Exposes a small typed API:
//!
//! - `initialize`
//! - `new_session`
//! - `prompt`
//! - `cancel`
//! - `subscribe_updates()` for incoming `session/update` notifications
//!
//! Inbound agent requests (permissions, fs, terminal) are dispatched via
//! typed channels in [`DispatchChannels`] to handler tasks that have
//! access to the session profile and project root.
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

use super::debug::{AcpDebugDirection, AcpDebugLog};
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

/// Stage X6 batch 4-1 — typed result of an ACP `session/load` request.
///
/// Returned by [`AcpClient::load_session`]. Maps JSON-RPC error codes
/// onto a closed enum so the resume FSM can branch deterministically
/// without re-inspecting the underlying [`JsonRpcError`].
///
/// - `-32601` (method not found) → [`LoadSessionError::Unsupported`].
///   The adapter doesn't implement `session/load`. The bridge SHOULD
///   fall back to replay-only resume.
/// - `-32602` (invalid params) → [`LoadSessionError::Rejected`]. The
///   adapter recognized the call but refused this specific session
///   (unknown id, bad cwd, etc.).
/// - everything else (including transport / timeout / decode errors)
///   → [`LoadSessionError::Other`]. The bridge SHOULD treat this as a
///   hard failure for the resume attempt and surface
///   `session.resume.failed { reason: "native_resume_unsupported" }`
///   only after the FE has the chance to retry replay-only.
#[derive(Debug)]
pub enum LoadSessionError {
    Unsupported(JsonRpcError),
    Rejected(JsonRpcError),
    Other(anyhow::Error),
}

impl LoadSessionError {
    /// Internal helper: extract a `JsonRpcError` from an `anyhow::Error`
    /// returned by `rpc()` and classify it. Anything that doesn't carry
    /// a `JsonRpcError` cause stays as `Other`.
    fn from_anyhow(err: anyhow::Error) -> Self {
        match err.downcast_ref::<JsonRpcError>() {
            Some(rpc) if rpc.code == -32601 => Self::Unsupported(rpc.clone()),
            Some(rpc) if rpc.code == -32602 => Self::Rejected(rpc.clone()),
            _ => Self::Other(err),
        }
    }

    /// Stable bridge-side error code for ack payloads. Mirrors the
    /// shape used by `classify_jsonrpc_error` for the existing prompt /
    /// new_session paths.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported(_) => "native_resume_unsupported",
            Self::Rejected(_) => "native_resume_rejected",
            Self::Other(_) => "native_resume_failed",
        }
    }

    /// Human-readable message for ack / event payloads.
    pub fn message(&self) -> String {
        match self {
            Self::Unsupported(e) | Self::Rejected(e) => format!("{}", e),
            Self::Other(e) => format!("{:#}", e),
        }
    }
}

impl std::fmt::Display for LoadSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "session/load {}: {}", self.code(), self.message())
    }
}

impl std::error::Error for LoadSessionError {}

/// Inbound `session/request_permission` request held open for the
/// approval bridge. The numeric `id` must round-trip into the JSON-RPC
/// response that resolves it. See `AcpClient::respond_permission`.
#[derive(Debug)]
pub struct PermissionRequest {
    pub id: u64,
    pub params: Value,
}

/// Inbound `fs/read_text_file` or `fs/write_text_file` request from
/// the agent. Routed to a handler task that has access to the session
/// profile for enforcement.
#[derive(Debug)]
pub struct FsRequest {
    pub id: u64,
    pub method: String,
    pub params: Value,
}

/// Inbound `terminal/*` request from the agent. Routed to a handler
/// task that manages terminal lifecycle with shell enforcement.
#[derive(Debug)]
pub struct TerminalRequest {
    pub id: u64,
    pub method: String,
    pub params: Value,
}

/// All inbound request channels grouped for `dispatch_line`. Each
/// channel routes a category of agent requests to the handler task
/// that owns the session/profile context for that category.
pub(crate) struct DispatchChannels {
    pub permission_tx: tokio::sync::mpsc::UnboundedSender<PermissionRequest>,
    pub fs_tx: tokio::sync::mpsc::UnboundedSender<FsRequest>,
    pub terminal_tx: tokio::sync::mpsc::UnboundedSender<TerminalRequest>,
}

pub struct AcpClient {
    next_id: Arc<Mutex<u64>>,
    pending: Pending,
    stdin_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    /// Broadcast receiver for inbound `session/update` notifications.
    /// Subscribers attach with `subscribe_updates()`.
    updates: broadcast::Sender<SessionNotification>,
    /// Single-consumer receiver for `session/request_permission`
    /// requests. SessionHandle's ACP path takes this once at spawn
    /// time. Stage X.5c.1 hook.
    permission_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<PermissionRequest>>>,
    /// Single-consumer receiver for `fs/*` inbound requests.
    fs_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<FsRequest>>>,
    /// Single-consumer receiver for `terminal/*` inbound requests.
    terminal_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<TerminalRequest>>>,
}

impl AcpClient {
    /// Spawn the ACP child and start the reader/writer tasks. Returns
    /// the handle plus a JoinHandle on the child for the caller's
    /// watchdog (existing X.3 child-exit handling reuses it).
    pub fn spawn(
        command: &std::path::Path,
        args: &[String],
        env: &[(String, String)],
        debug: Option<Arc<AcpDebugLog>>,
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
        let (perm_tx, perm_rx) = tokio::sync::mpsc::unbounded_channel::<PermissionRequest>();
        let (fs_tx, fs_rx) = tokio::sync::mpsc::unbounded_channel::<FsRequest>();
        let (terminal_tx, terminal_rx) = tokio::sync::mpsc::unbounded_channel::<TerminalRequest>();

        // Writer task — owns stdin, receives ndjson lines from a channel.
        spawn_writer(stdin, stdin_rx, debug.clone());

        let channels = DispatchChannels {
            permission_tx: perm_tx,
            fs_tx,
            terminal_tx,
        };

        // Reader task — owns stdout, dispatches responses/notifications.
        // Inbound agent requests are routed via DispatchChannels to
        // handler tasks that have session/profile context.
        spawn_reader(
            stdout,
            Arc::clone(&pending),
            updates_tx.clone(),
            stdin_tx.clone(),
            channels,
            debug.clone(),
        );

        // Stderr pump — bridge debug logs only.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if let Some(debug) = debug.as_ref() {
                    debug.record_stderr_line(&l).await;
                }
                debug!(target: "acp.stderr", "{l}");
            }
        });

        let client = AcpClient {
            next_id: Arc::new(Mutex::new(1)),
            pending,
            stdin_tx,
            updates: updates_tx,
            permission_rx: Mutex::new(Some(perm_rx)),
            fs_rx: Mutex::new(Some(fs_rx)),
            terminal_rx: Mutex::new(Some(terminal_rx)),
        };
        Ok((client, child))
    }

    pub fn subscribe_updates(&self) -> broadcast::Receiver<SessionNotification> {
        self.updates.subscribe()
    }

    /// Take the permission-request receiver. Single-consumer; only the
    /// SessionHandle's ACP spawn path calls this, exactly once.
    pub async fn take_permission_receiver(
        &self,
    ) -> Option<tokio::sync::mpsc::UnboundedReceiver<PermissionRequest>> {
        self.permission_rx.lock().await.take()
    }

    /// Take the fs-request receiver. Single-consumer; the session's fs
    /// handler task takes this once at spawn time.
    pub async fn take_fs_receiver(
        &self,
    ) -> Option<tokio::sync::mpsc::UnboundedReceiver<FsRequest>> {
        self.fs_rx.lock().await.take()
    }

    /// Take the terminal-request receiver. Single-consumer; the
    /// session's terminal handler task takes this once at spawn time.
    pub async fn take_terminal_receiver(
        &self,
    ) -> Option<tokio::sync::mpsc::UnboundedReceiver<TerminalRequest>> {
        self.terminal_rx.lock().await.take()
    }

    /// Resolve a pending `session/request_permission` request by its
    /// JSON-RPC `id` with the given `outcome` value. Used by the X.5c.1
    /// approval bridge once the user (or policy) decides.
    ///
    /// `outcome` should be a `RequestPermissionResponse` shape:
    /// `{ "outcome": { "outcome": "selected", "optionId": "<id>" } }`
    /// or `{ "outcome": { "outcome": "cancelled" } }`.
    pub fn respond_permission(&self, id: u64, outcome: Value) -> Result<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": outcome,
        });
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        self.write_line(bytes)
    }

    /// Send a successful JSON-RPC response for an inbound fs or
    /// terminal request.
    pub fn respond_result(&self, id: u64, result: Value) -> Result<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        });
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        self.write_line(bytes)
    }

    /// Send an error JSON-RPC response for an inbound fs or terminal
    /// request.
    pub fn respond_error(&self, id: u64, code: i64, message: String, data: Value) -> Result<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message, "data": data },
        });
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        self.write_line(bytes)
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

    /// Stage X6 batch 4-1 — ACP `session/load` request.
    ///
    /// Re-attaches the agent to a previously persisted session. The
    /// adapter MUST replay any history via `session/update`
    /// notifications **before** the response resolves — callers should
    /// already have their `session/update` pump running by the time
    /// they invoke this method or they will miss the replay.
    ///
    /// Errors map JSON-RPC codes to the structured
    /// [`LoadSessionError`] enum so the resume FSM can decide whether
    /// to fall back to replay-only ([`LoadSessionError::Unsupported`])
    /// or surface a hard failure ([`LoadSessionError::Rejected`]).
    pub async fn load_session(
        &self,
        req: LoadSessionRequest,
    ) -> std::result::Result<LoadSessionResponse, LoadSessionError> {
        match self
            .rpc::<_, LoadSessionResponse>("session/load", req, Some(REQUEST_TIMEOUT))
            .await
        {
            Ok(resp) => Ok(resp),
            Err(err) => Err(LoadSessionError::from_anyhow(err)),
        }
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

    /// Stage X.5d — ACP `authenticate` request. Used by the bridge's
    /// `session.authenticate` command path to drive Zed-style reauth
    /// flows (e.g. Claude Pro/Max OAuth via `claude-login`).
    ///
    /// The request itself is bounded by `REQUEST_TIMEOUT`; for
    /// adapter-managed flows that wait on a browser/CLI step the
    /// adapter is expected to gate on its own internal state and
    /// either resolve or fail this call within the timeout.
    pub async fn authenticate(&self, req: AuthenticateRequest) -> Result<AuthenticateResponse> {
        self.rpc("authenticate", req, Some(REQUEST_TIMEOUT)).await
    }
}

fn spawn_writer(
    mut stdin: ChildStdin,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    debug: Option<Arc<AcpDebugLog>>,
) {
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if let Some(debug) = debug.as_ref() {
                if let Ok(line) = std::str::from_utf8(&bytes) {
                    debug
                        .record_wire_line(AcpDebugDirection::Outgoing, line)
                        .await;
                }
            }
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
    writer_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    channels: DispatchChannels,
    debug: Option<Arc<AcpDebugLog>>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Some(debug) = debug.as_ref() {
                        debug
                            .record_wire_line(AcpDebugDirection::Incoming, &line)
                            .await;
                    }
                    if let Err(e) =
                        dispatch_line(&line, &pending, &updates, &writer_tx, &channels).await
                    {
                        warn!(error=%e, line=%line, "acp reader: dispatch failed");
                    }
                }
                Ok(None) => {
                    info!("acp reader: stdout EOF");
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
    writer_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    channels: &DispatchChannels,
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
        debug!(target: "acp", method, "notification ignored");
        return Ok(());
    }

    // Inbound request from the agent.
    if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
        // Stage X.5c.1 — surface session/request_permission to the
        // approval bridge.
        if method == "session/request_permission" {
            if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                let params = v.get("params").cloned().unwrap_or(Value::Null);
                if channels
                    .permission_tx
                    .send(PermissionRequest { id, params })
                    .is_err()
                {
                    warn!(
                        id,
                        "session/request_permission: receiver dropped; auto-cancelling"
                    );
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "outcome": { "outcome": "cancelled" } }
                    });
                    let mut bytes = serde_json::to_vec(&resp)?;
                    bytes.push(b'\n');
                    let _ = writer_tx.send(bytes);
                }
                return Ok(());
            }
            warn!("session/request_permission without numeric id; ignoring");
            return Ok(());
        }

        // Stage X.5c.3 — route fs/* requests to the fs handler task.
        if method == "fs/read_text_file" || method == "fs/write_text_file" {
            if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                let params = v.get("params").cloned().unwrap_or(Value::Null);
                if channels
                    .fs_tx
                    .send(FsRequest {
                        id,
                        method: method.to_string(),
                        params,
                    })
                    .is_err()
                {
                    warn!(id, method, "fs request: handler unavailable");
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32603, "message": "fs handler unavailable", "data": { "method": method } }
                    });
                    let mut bytes = serde_json::to_vec(&resp)?;
                    bytes.push(b'\n');
                    let _ = writer_tx.send(bytes);
                }
                return Ok(());
            }
            warn!(method, "fs request without numeric id; ignoring");
            return Ok(());
        }

        // Stage X.5c.3 — route terminal/* requests to the terminal
        // handler task.
        if method.starts_with("terminal/") {
            if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                let params = v.get("params").cloned().unwrap_or(Value::Null);
                if channels
                    .terminal_tx
                    .send(TerminalRequest {
                        id,
                        method: method.to_string(),
                        params,
                    })
                    .is_err()
                {
                    warn!(id, method, "terminal request: handler unavailable");
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32603, "message": "terminal handler unavailable", "data": { "method": method } }
                    });
                    let mut bytes = serde_json::to_vec(&resp)?;
                    bytes.push(b'\n');
                    let _ = writer_tx.send(bytes);
                }
                return Ok(());
            }
            warn!(method, "terminal request without numeric id; ignoring");
            return Ok(());
        }

        // Fallback for unknown inbound methods.
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        let resp = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not handled by bridge: {method}"),
                "data": { "method": method }
            }
        });
        let mut bytes = serde_json::to_vec(&resp)?;
        bytes.push(b'\n');
        if writer_tx.send(bytes).is_err() {
            warn!(method, "ACP inbound request: writer channel closed");
        } else {
            debug!(target: "acp", method, "ACP inbound request answered with -32601");
        }
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
    fn x6_b41_load_session_error_classifies_jsonrpc_codes() {
        // -32601 -> Unsupported
        let e = anyhow::Error::from(JsonRpcError {
            code: -32601,
            message: "method not found".into(),
            data: Value::Null,
        });
        let mapped = LoadSessionError::from_anyhow(e);
        assert!(matches!(mapped, LoadSessionError::Unsupported(_)));
        assert_eq!(mapped.code(), "native_resume_unsupported");

        // -32602 -> Rejected
        let e = anyhow::Error::from(JsonRpcError {
            code: -32602,
            message: "unknown sessionId".into(),
            data: json!({"sessionId": "sess_x"}),
        });
        let mapped = LoadSessionError::from_anyhow(e);
        assert!(matches!(mapped, LoadSessionError::Rejected(_)));
        assert_eq!(mapped.code(), "native_resume_rejected");
        assert!(mapped.message().contains("unknown sessionId"));

        // -32603 (or anything else) -> Other
        let e = anyhow::Error::from(JsonRpcError {
            code: -32603,
            message: "internal".into(),
            data: Value::Null,
        });
        let mapped = LoadSessionError::from_anyhow(e);
        assert!(matches!(mapped, LoadSessionError::Other(_)));
        assert_eq!(mapped.code(), "native_resume_failed");

        // non-JsonRpc anyhow error -> Other
        let e = anyhow!("transport closed");
        let mapped = LoadSessionError::from_anyhow(e);
        assert!(matches!(mapped, LoadSessionError::Other(_)));
        assert_eq!(mapped.code(), "native_resume_failed");
    }

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

    fn test_channels() -> (
        DispatchChannels,
        tokio::sync::mpsc::UnboundedReceiver<PermissionRequest>,
        tokio::sync::mpsc::UnboundedReceiver<FsRequest>,
        tokio::sync::mpsc::UnboundedReceiver<TerminalRequest>,
    ) {
        let (perm_tx, perm_rx) = tokio::sync::mpsc::unbounded_channel::<PermissionRequest>();
        let (fs_tx, fs_rx) = tokio::sync::mpsc::unbounded_channel::<FsRequest>();
        let (term_tx, term_rx) = tokio::sync::mpsc::unbounded_channel::<TerminalRequest>();
        (
            DispatchChannels {
                permission_tx: perm_tx,
                fs_tx,
                terminal_tx: term_tx,
            },
            perm_rx,
            fs_rx,
            term_rx,
        )
    }

    #[tokio::test]
    async fn inbound_unknown_method_receives_32601() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, mut writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, _perm_rx, _fs_rx, _term_rx) = test_channels();

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 17,
            "method": "some/unknown_method",
            "params": {}
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        let bytes = writer_rx.try_recv().expect("expected response on writer");
        let resp: Value = serde_json::from_slice(bytes.trim_ascii_end()).unwrap();
        assert_eq!(resp["jsonrpc"], json!("2.0"));
        assert_eq!(resp["id"], json!(17));
        assert_eq!(resp["error"]["code"], json!(-32601));
    }

    #[tokio::test]
    async fn fs_read_request_routes_to_fs_channel() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, mut writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, _perm_rx, mut fs_rx, _term_rx) = test_channels();

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "fs/read_text_file",
            "params": { "sessionId": "sid", "path": "/tmp/x" }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        assert!(
            writer_rx.try_recv().is_err(),
            "fs request must be held open for handler"
        );
        let req = fs_rx.try_recv().expect("fs request on channel");
        assert_eq!(req.id, 42);
        assert_eq!(req.method, "fs/read_text_file");
        assert_eq!(req.params["path"], json!("/tmp/x"));
    }

    #[tokio::test]
    async fn fs_write_request_routes_to_fs_channel() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, _writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, _perm_rx, mut fs_rx, _term_rx) = test_channels();

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 43,
            "method": "fs/write_text_file",
            "params": { "sessionId": "sid", "path": "/tmp/x", "content": "hello" }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        let req = fs_rx.try_recv().expect("fs write request on channel");
        assert_eq!(req.id, 43);
        assert_eq!(req.method, "fs/write_text_file");
    }

    #[tokio::test]
    async fn terminal_request_routes_to_terminal_channel() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, _writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, _perm_rx, _fs_rx, mut term_rx) = test_channels();

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 50,
            "method": "terminal/create",
            "params": { "sessionId": "sid", "command": "echo", "args": ["hello"] }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        let req = term_rx.try_recv().expect("terminal request on channel");
        assert_eq!(req.id, 50);
        assert_eq!(req.method, "terminal/create");
    }

    #[tokio::test]
    async fn fs_request_auto_errors_when_handler_dropped() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, mut writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, _perm_rx, fs_rx, _term_rx) = test_channels();
        drop(fs_rx);

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 44,
            "method": "fs/read_text_file",
            "params": { "path": "/tmp/x" }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        let bytes = writer_rx.try_recv().expect("auto-error response");
        let resp: Value = serde_json::from_slice(bytes.trim_ascii_end()).unwrap();
        assert_eq!(resp["id"], json!(44));
        assert_eq!(resp["error"]["code"], json!(-32603));
    }

    #[tokio::test]
    async fn inbound_session_request_permission_routes_to_permission_channel() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, mut writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, mut perm_rx, _fs_rx, _term_rx) = test_channels();

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "session/request_permission",
            "params": {
                "sessionId": "sid",
                "toolCall": { "kind": "edit", "toolCallId": "tc-1" },
                "options": [
                    { "kind": "allow_once", "name": "Allow", "optionId": "allow" },
                    { "kind": "reject_once", "name": "Reject", "optionId": "reject" }
                ]
            }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        assert!(
            writer_rx.try_recv().is_err(),
            "session/request_permission must be held open, not auto-replied"
        );

        let req = perm_rx.try_recv().expect("permission request on channel");
        assert_eq!(req.id, 5);
        assert_eq!(req.params["sessionId"], json!("sid"));
        assert_eq!(req.params["options"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn permission_request_auto_cancels_when_receiver_dropped() {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, _updates_rx) = broadcast::channel::<SessionNotification>(8);
        let (writer_tx, mut writer_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (channels, perm_rx, _fs_rx, _term_rx) = test_channels();
        drop(perm_rx);
        // Also need to keep channels alive for other senders
        let _keep_channels = &channels;

        let inbound = json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "session/request_permission",
            "params": { "sessionId": "sid", "toolCall": {}, "options": [] }
        });
        super::dispatch_line(
            &inbound.to_string(),
            &pending,
            &updates_tx,
            &writer_tx,
            &channels,
        )
        .await
        .expect("dispatch ok");

        let bytes = writer_rx.try_recv().expect("auto-cancel response");
        let resp: Value = serde_json::from_slice(bytes.trim_ascii_end()).unwrap();
        assert_eq!(resp["id"], json!(9));
        assert_eq!(resp["result"]["outcome"]["outcome"], json!("cancelled"));
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
