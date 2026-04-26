//! Per-session state + child process handle.

use crate::agent_runtime::acp::{
    classify_jsonrpc_error, AcpClient, ClientCapabilities, ContentBlock, FsClientCapabilities,
    InitializeRequest, NewSessionRequest, PromptRequest, SessionNotification,
};
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

/// ACP-specific runtime state. Present iff `agent_kind = Acp`.
pub struct AcpRuntime {
    pub client: AcpClient,
    /// ACP session id obtained from the agent's `session/new` response.
    /// Distinct from VAC's `SessionHandle::id` — the bridge needs both
    /// to route prompts and cancellations.
    pub acp_session_id: String,
}

pub struct SessionHandle {
    pub id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent_id: String,
    pub agent_kind: AgentKind,
    pub state: Arc<StateHolder>,
    pub ring: Arc<RwLock<EventRing<ServerEvent>>>,
    /// Stdin for Mock / VacNative engines (legacy JSON-RPC notification
    /// dialect). `None` for ACP — `acp.client` owns its own stdin.
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub broadcast: broadcast::Sender<ServerEvent>,
    /// ACP runtime state when this session is backed by an ACP agent.
    pub acp: Option<Arc<AcpRuntime>>,
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
        match opts.agent.kind {
            AgentKind::Acp => Self::spawn_acp(opts).await,
            AgentKind::Mock | AgentKind::VacNative => Self::spawn_jsonrpc(opts).await,
        }
    }

    /// Legacy JSON-RPC notification stdio engines: mock-engine and
    /// `vac serve`. CLI arg conventions preserved verbatim.
    async fn spawn_jsonrpc(opts: SpawnOptions) -> anyhow::Result<SessionHandleRef> {
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
            acp: None,
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

        // JSON-RPC notification stream — Mock + VacNative dialect.
        let handle_clone = Arc::clone(&handle);
        let kind = handle.agent_kind;
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                process_jsonrpc_line(&line, &handle_clone).await;
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
    /// of the backing agent and forward it to the child.
    ///
    /// - `Mock` / `VacNative` → JSON-RPC notification on stdin
    ///   `{"jsonrpc":"2.0","id":<cmd.id>,"method":<cmd.cmd_type>,"params":<cmd.payload>}`.
    /// - `Acp` (Stage X.5b) → typed ACP requests via the in-process
    ///   `AcpClient`. Currently:
    ///     - `message.submit` → `session/prompt`. The prompt response
    ///       and intervening `session/update` notifications are pumped
    ///       into VAC events by the spawn-time subscriber task.
    ///     - `message.cancel_stream` → `session/cancel` (notification).
    ///     - everything else → `agent.protocol_unsupported` (X.5c
    ///       widens this).
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
            AgentKind::Acp => self.handle_acp_command(cmd).await,
        }
    }

    async fn handle_acp_command(&self, cmd: &ClientCommand) -> anyhow::Result<()> {
        let acp = self
            .acp
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("ACP runtime not initialized for this session"))?;
        match cmd.cmd_type.as_str() {
            "message.submit" => {
                let text = cmd
                    .payload
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let req = PromptRequest {
                    session_id: acp.acp_session_id.clone(),
                    prompt: vec![ContentBlock::Text { text }],
                };
                // Fire prompt; response handler (spawned at session
                // creation) emits transcript.completed when this future
                // resolves. We don't await here — the bridge ack should
                // return ok=true immediately and the user observes the
                // streamed deltas as they land.
                let acp = Arc::clone(acp);
                let handle_id = self.id.clone();
                let bcast = self.broadcast.clone();
                let ring = Arc::clone(&self.ring);
                tokio::spawn(async move {
                    match acp.client.prompt(req).await {
                        Ok(resp) => {
                            let event = ServerEvent {
                                seq: 0,
                                session_id: handle_id.clone(),
                                event_type: "transcript.completed".into(),
                                payload: serde_json::json!({
                                    "stop_reason": resp.stop_reason,
                                    "usage": resp.usage,
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            };
                            emit_to(&ring, &bcast, event).await;
                        }
                        Err(e) => {
                            warn!(error=%e, "ACP session/prompt failed");
                            // If the underlying error is a JsonRpcError
                            // from the agent, classify it into a stable
                            // bridge code so web clients can react
                            // (session.not_found, agent.protocol_invalid_params,
                            // agent.protocol_unsupported, agent.internal,
                            // agent.protocol_error) instead of just a
                            // free-form string.
                            let code = e
                                .downcast_ref::<crate::agent_runtime::acp::JsonRpcError>()
                                .map(classify_jsonrpc_error)
                                .unwrap_or("agent.protocol_error");
                            let event = ServerEvent {
                                seq: 0,
                                session_id: handle_id.clone(),
                                event_type: "transcript.error".into(),
                                payload: serde_json::json!({
                                    "reason": "prompt_failed",
                                    "code": code,
                                    "error": e.to_string(),
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            };
                            emit_to(&ring, &bcast, event).await;
                        }
                    }
                });
                Ok(())
            }
            "message.cancel_stream" => acp.client.cancel(&acp.acp_session_id).await,
            other => anyhow::bail!(
                "agent.protocol_unsupported: command '{other}' is not yet wired for ACP (X.5c scope)"
            ),
        }
    }

    pub async fn close_stdin(&self) {
        let _ = self.stdin.lock().await.take();
    }
}

async fn emit_event(handle: &SessionHandleRef, event: ServerEvent) {
    emit_to(&handle.ring, &handle.broadcast, event).await;
}

async fn emit_to(
    ring: &Arc<RwLock<EventRing<ServerEvent>>>,
    bcast: &broadcast::Sender<ServerEvent>,
    event: ServerEvent,
) {
    let seq = {
        let mut r = ring.write().await;
        r.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = bcast.send(with_seq);
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

impl SessionHandle {
    /// Stage X.5b — official ACP path. Spawn the agent binary, run
    /// `initialize`, open a session via `session/new`, and start a
    /// task that pumps `session/update` notifications into VAC events.
    /// CLI args follow `agent.args` *only* — no `--profile/--session-id/
    /// --project` because the ACP client conveys cwd via
    /// `session/new.params.cwd`.
    async fn spawn_acp(opts: SpawnOptions) -> anyhow::Result<SessionHandleRef> {
        let (client, mut child) = AcpClient::spawn(&opts.agent.command, &opts.agent.args, &[])?;

        // Handshake.
        let init_req = InitializeRequest {
            protocol_version: 1,
            client_capabilities: ClientCapabilities {
                fs: FsClientCapabilities {
                    // X.5c will flip these to true and serve the requests
                    // through profile_layer enforcement.
                    read_text_file: false,
                    write_text_file: false,
                },
                terminal: false,
            },
        };
        let _init = client.initialize(init_req).await?;

        // Open ACP session bound to the project root.
        let new_req = NewSessionRequest {
            cwd: opts
                .project_root
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("project_root not utf-8"))?
                .to_string(),
            mcp_servers: vec![],
        };
        let new_resp = client.new_session(new_req).await?;
        let acp_session_id = new_resp.session_id.clone();

        // Wire the rest of the bridge state.
        let state = Arc::new(StateHolder::new());
        let ring = Arc::new(RwLock::new(EventRing::<ServerEvent>::new(5000)));
        let (bcast_tx, _) = broadcast::channel::<ServerEvent>(512);

        let mut update_rx = client.subscribe_updates();
        let acp_runtime = Arc::new(AcpRuntime {
            client,
            acp_session_id: acp_session_id.clone(),
        });

        let handle = Arc::new(Self {
            id: opts.session_id.clone(),
            profile_id: opts.profile_id.clone(),
            project_root: opts.project_root.clone(),
            agent_id: opts.agent.id.clone(),
            agent_kind: opts.agent.kind,
            state: Arc::clone(&state),
            ring: Arc::clone(&ring),
            stdin: Arc::new(Mutex::new(None)),
            broadcast: bcast_tx.clone(),
            acp: Some(Arc::clone(&acp_runtime)),
        });

        info!(
            session_id = %handle.id,
            profile_id = %handle.profile_id,
            agent_id = %handle.agent_id,
            agent_kind = %handle.agent_kind.as_str(),
            command = %opts.agent.command.display(),
            project_root = %handle.project_root.display(),
            acp_session_id = %acp_session_id,
            "ACP session opened"
        );

        state.transition(bridge_core::SessionState::Ready).ok();

        // Pump session/update notifications → VAC transcript.delta.
        // Out-of-scope variants (tool_call, plan, usage_update, etc) are
        // logged at debug for X.5c to consume.
        let pump_handle = Arc::clone(&handle);
        tokio::spawn(async move {
            loop {
                match update_rx.recv().await {
                    Ok(notif) => map_acp_update(&pump_handle, notif).await,
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(session = %pump_handle.id, lagged = n, "ACP update broadcast lagged");
                    }
                }
            }
        });

        // Watchdog — same shape as JSON-RPC path.
        let handle_wait = Arc::clone(&handle);
        tokio::spawn(async move {
            let status = child.wait().await;
            info!(session = %handle_wait.id, status = ?status, "ACP child exited");
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
}

/// Map an ACP `session/update` notification onto the VAC event surface.
/// Stage X.5b handles the chunk variants only:
///
/// - `agent_message_chunk` → `transcript.delta` `{ delta }`
/// - `agent_thought_chunk` → `transcript.delta` `{ delta, kind: "thought" }`
///
/// Every other variant is logged at debug — X.5c hooks tool_call,
/// plan, and usage_update into review/runtime/agents lanes.
async fn map_acp_update(handle: &SessionHandleRef, notif: SessionNotification) {
    let Some(disc) = notif.discriminator() else {
        return;
    };
    let ts = chrono::Utc::now().to_rfc3339();
    match disc {
        "agent_message_chunk" => {
            let delta = notif.message_chunk_text().unwrap_or_default();
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
        "agent_thought_chunk" => {
            let delta = notif.message_chunk_text().unwrap_or_default();
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.delta".into(),
                payload: serde_json::json!({ "delta": delta, "kind": "thought" }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        other => {
            tracing::debug!(
                session = %handle.id,
                variant = %other,
                "ACP session/update variant ignored at X.5b scope"
            );
        }
    }
}

// X.5c will use this to surface json-rpc protocol errors as typed acks.
#[allow(dead_code)]
fn classify_for_ack(e: &crate::agent_runtime::acp::JsonRpcError) -> &'static str {
    classify_jsonrpc_error(e)
}
