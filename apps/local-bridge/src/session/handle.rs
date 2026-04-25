//! Per-session state + child process handle.

use crate::agent_runtime::{AgentDefinition, AgentKind};
use crate::ws::envelope::{ClientCommand, ServerEvent};
use bridge_core::{EventRing, StateHolder};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex, RwLock};
use tracing::{info, warn};

pub type SessionHandleRef = Arc<SessionHandle>;

pub struct SessionHandle {
    pub id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent_id: String,
    pub agent_kind: AgentKind,
    pub state: Arc<StateHolder>,
    pub ring: Arc<RwLock<EventRing<ServerEvent>>>,
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub broadcast: broadcast::Sender<ServerEvent>,
}

pub struct SpawnOptions {
    pub session_id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent: AgentDefinition,
}

impl SessionHandle {
    /// Spawn child engine process (mock-engine or vac serve) + wire stdio.
    ///
    /// Stage X.1: the engine binary now flows through an
    /// [`AgentDefinition`] resolved from the runtime registry. The
    /// effective command line is preserved exactly:
    ///
    /// ```text
    /// <agent.command> <agent.args...> --profile <p> --session-id <s> --project <root>
    /// ```
    ///
    /// `agent.args` defaults to `["--stdio"]` for mock + vac-native via
    /// the embedded config, matching the pre-X.1 hardcoded arg order.
    pub async fn spawn(opts: SpawnOptions) -> anyhow::Result<SessionHandleRef> {
        let mut cmd = Command::new(&opts.agent.command);
        cmd.args(&opts.agent.args)
            .arg("--profile")
            .arg(&opts.profile_id)
            .arg("--session-id")
            .arg(&opts.session_id)
            .arg("--project")
            .arg(&opts.project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child: Child = cmd.spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stderr"))?;

        let state = Arc::new(StateHolder::new());
        let ring = Arc::new(RwLock::new(EventRing::<ServerEvent>::new(5000)));
        let (bcast_tx, _) = broadcast::channel::<ServerEvent>(512);

        let handle = Arc::new(Self {
            id: opts.session_id.clone(),
            profile_id: opts.profile_id.clone(),
            project_root: opts.project_root.clone(),
            agent_id: opts.agent.id.clone(),
            agent_kind: opts.agent.kind,
            state: Arc::clone(&state),
            ring: Arc::clone(&ring),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            broadcast: bcast_tx.clone(),
        });

        info!(
            session_id = %handle.id,
            profile_id = %handle.profile_id,
            agent_id = %handle.agent_id,
            agent_kind = %handle.agent_kind.as_str(),
            command = %opts.agent.command.display(),
            project_root = %handle.project_root.display(),
            "session spawned"
        );

        state.transition(bridge_core::SessionState::Ready).ok();

        // Pump stderr to tracing.
        let sid_err = handle.id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                tracing::debug!(session = %sid_err, "engine_stderr: {l}");
            }
        });

        // Pump stdout → ring + broadcast. Stage X.3 dispatches the
        // line processor by agent kind: Mock + VacNative use the
        // historical JSON-RPC notification shape; Acp speaks a small
        // ACP-style envelope mapped to transcript.delta. The driver
        // layer is intentionally per-line so the rest of the spawn
        // path stays uniform.
        let handle_clone = Arc::clone(&handle);
        let kind = handle.agent_kind;
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match kind {
                    AgentKind::Mock | AgentKind::VacNative => {
                        process_jsonrpc_line(&line, &handle_clone).await
                    }
                    AgentKind::Acp => process_acp_line(&line, &handle_clone).await,
                }
            }
            info!(session = %handle_clone.id, agent_kind = %kind.as_str(), "engine stdout closed");
            let _ = handle_clone
                .state
                .transition(bridge_core::SessionState::Closing);
            let _ = handle_clone
                .state
                .transition(bridge_core::SessionState::Closed);
        });

        // Spawn watchdog: when child exits, transition state. Non-zero
        // exits emit a transcript.error event so web surfaces can
        // distinguish a clean close from a crash.
        let handle_wait = Arc::clone(&handle);
        tokio::spawn(async move {
            let status = child.wait().await;
            info!(session = %handle_wait.id, status = ?status, "child exited");
            let crashed = status.as_ref().map(|s| !s.success()).unwrap_or(true);
            if crashed {
                let ts = chrono::Utc::now().to_rfc3339();
                let event = ServerEvent {
                    seq: 0,
                    session_id: handle_wait.id.clone(),
                    event_type: "transcript.error".into(),
                    payload: serde_json::json!({
                        "reason": "child_exited",
                        "agent_id": handle_wait.agent_id,
                        "agent_kind": handle_wait.agent_kind.as_str(),
                        "status": format!("{status:?}"),
                    }),
                    v: 1,
                    ts,
                };
                emit_event(&handle_wait, event).await;
            }
            let _ = handle_wait
                .state
                .transition(bridge_core::SessionState::Closing);
            let _ = handle_wait
                .state
                .transition(bridge_core::SessionState::Closed);
        });

        Ok(handle)
    }

    pub async fn send_to_engine(&self, line: &str) -> anyhow::Result<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("stdin closed"))?;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Translate a browser-side `ClientCommand` into the wire dialect
    /// of the backing agent and forward it to the child's stdin.
    ///
    /// - `Mock` / `VacNative` → JSON-RPC notification
    ///   `{"jsonrpc":"2.0","id":<cmd.id>,"method":<cmd.cmd_type>,"params":<cmd.payload>}`.
    ///   Preserves the historical wire shape mock-engine + `vac serve`
    ///   already speak.
    /// - `Acp` → ACP envelope. Currently only `message.submit` is
    ///   mapped (Stage X.3 scaffold) to:
    ///   `{"type":"prompt","text":<payload.text>,"mentions":<payload.mentions?>,"attachments":<payload.attachments?>}`.
    ///   Other commands return `agent.protocol_unsupported` until X.5
    ///   widens the ACP envelope set (tool/permission/file-write
    ///   translation lands there).
    pub async fn send_client_command(&self, cmd: &ClientCommand) -> anyhow::Result<()> {
        match self.agent_kind {
            AgentKind::Mock | AgentKind::VacNative => {
                let rpc = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": cmd.id,
                    "method": cmd.cmd_type,
                    "params": cmd.payload,
                });
                self.send_to_engine(&rpc.to_string()).await
            }
            AgentKind::Acp => match cmd.cmd_type.as_str() {
                "message.submit" => {
                    let text = cmd
                        .payload
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let mut envelope = serde_json::json!({
                        "type": "prompt",
                        "text": text,
                    });
                    if let Some(m) = cmd.payload.get("mentions").cloned() {
                        envelope["mentions"] = m;
                    }
                    if let Some(a) = cmd.payload.get("attachments").cloned() {
                        envelope["attachments"] = a;
                    }
                    self.send_to_engine(&envelope.to_string()).await
                }
                other => anyhow::bail!(
                    "agent.protocol_unsupported: command '{other}' is not yet wired for ACP (X.5 scope)"
                ),
            },
        }
    }

    pub async fn close_stdin(&self) {
        let _ = self.stdin.lock().await.take();
    }
}

async fn emit_event(handle: &SessionHandleRef, event: ServerEvent) {
    let seq = {
        let mut ring = handle.ring.write().await;
        ring.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = handle.broadcast.send(with_seq);
}

/// JSON-RPC notification line processor — used for Mock + VacNative
/// engines. The mock-engine + future `vac serve --stdio` both speak
/// `{"jsonrpc":"2.0","method":"…","params":{…}}`; we pass-through
/// `method` as the event_type and `params` as the payload.
async fn process_jsonrpc_line(line: &str, handle: &SessionHandleRef) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            warn!(session = %handle.id, "engine emitted non-JSON: {e} | raw: {line}");
            return;
        }
    };

    let Some(method) = parsed.get("method").and_then(|m| m.as_str()) else {
        // Response to a request — route via correlation (Phase 1.3 handles).
        return;
    };

    let params = parsed
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let ts = chrono::Utc::now().to_rfc3339();

    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: method.to_string(),
        payload: params,
        v: 1,
        ts,
    };
    emit_event(handle, event).await;
}

/// ACP envelope line processor — Stage X.3 scaffold.
///
/// Today's ACP support is intentionally narrow: text-only assistant
/// streaming. The mock-acp child (and, after X.6, real Claude Code)
/// emits line-delimited JSON like:
///
/// ```json
/// {"type": "session_started", ...}
/// {"type": "assistant_message_chunk", "text": "..."}
/// {"type": "assistant_message_complete"}
/// ```
///
/// We map:
///   - `assistant_message_chunk` → `transcript.delta` event with
///     `{ delta }` payload.
///   - `assistant_message_complete` → `transcript.completed`.
///   - `session_started` → ignored (web already gets `session.ready`
///     from the bridge ack path).
///   - tool / permission / file-write envelopes are NOT handled here;
///     X.5 (permission bridge) wires those.
async fn process_acp_line(line: &str, handle: &SessionHandleRef) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            warn!(session = %handle.id, "acp emitted non-JSON: {e} | raw: {line}");
            return;
        }
    };
    let Some(kind) = parsed.get("type").and_then(|m| m.as_str()) else {
        return;
    };
    let ts = chrono::Utc::now().to_rfc3339();
    match kind {
        "assistant_message_chunk" => {
            let delta = parsed
                .get("text")
                .cloned()
                .unwrap_or(serde_json::Value::String(String::new()));
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.delta".into(),
                payload: serde_json::json!({ "delta": delta }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        "assistant_message_complete" => {
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.completed".into(),
                payload: serde_json::Value::Null,
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        "session_started" => {
            // Bridge already emits session.ready on ack — drop this.
        }
        other => {
            // Stage X.5 will widen this to permission/tool envelopes.
            // For now anything unknown is logged at debug only.
            tracing::debug!(session = %handle.id, kind = %other, "acp envelope ignored (X.3 scaffold)");
        }
    }
}
