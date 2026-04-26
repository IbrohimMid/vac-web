//! Per-session state + child process handle.

use crate::agent_runtime::acp::{
    classify_jsonrpc_error, extract_observed_tool_activity, sha256_hex_canonical,
    sha256_hex_canonical_excluding, AcpClient, AcpDebugLog, ClientCapabilities, ContentBlock,
    FsClientCapabilities, InitializeRequest, NewSessionRequest, PermissionRequest, PromptRequest,
    SessionNotification, ToolKind, ToolStatus, DEFAULT_RAW_OUTPUT_CAP_BYTES,
    TOOL_CALL_HASH_DROP_FIELDS,
};
use crate::agent_runtime::{AgentDefinition, AgentKind};
use crate::notify::{activity_event, Severity as NotifySeverity};
use crate::ws::envelope::{ClientCommand, ServerEvent};
use bridge_core::{EventRing, StateHolder};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex, RwLock};
use tracing::{info, warn};

use super::assessment_validation::{
    validate_candidate, AssessmentValidationTracker, CandidateFinding, CandidateRejection,
};

pub type SessionHandleRef = Arc<SessionHandle>;

/// One in-flight `session/request_permission` waiting on a user
/// decision via the bridge's `approval.approve` / `approval.reject`
/// commands. Stage X.5c.1.
#[derive(Debug, Clone)]
pub struct PendingApproval {
    /// JSON-RPC request id from the agent. Required to round-trip
    /// the response.
    pub acp_request_id: u64,
    /// Permission options as the agent sent them. Each entry is a
    /// JSON object with at least `optionId` and `kind`. Bridge picks
    /// one based on the user's approve/reject choice.
    pub options: Vec<serde_json::Value>,
    /// Agent's `toolCall` payload — surfaced to the UI verbatim so
    /// the user knows what they're approving.
    pub tool_call: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub timeout_handle: Arc<tokio::task::AbortHandle>,
}

/// X.5c.2 — recently-resolved approval kept around so subsequent
/// `tool_call` / `tool_call_update` notifications can attach
/// `approved_by_approval_id`. Two lookup keys per entry:
/// primary `(session_id, toolCallId)`, fallback
/// `(session_id, approval_tool_call_hash)`. TTL: 60s after resolve.
#[derive(Debug, Clone)]
pub(crate) struct ResolvedApprovalCacheEntry {
    pub(crate) approval_id: String,
    pub(crate) expires_at: tokio::time::Instant,
}

/// ACP-specific runtime state. Present iff `agent_kind = Acp`.
pub struct AcpRuntime {
    pub client: AcpClient,
    /// ACP session id obtained from the agent's `session/new` response.
    /// Distinct from VAC's `SessionHandle::id` — the bridge needs both
    /// to route prompts and cancellations.
    pub acp_session_id: String,
    /// In-flight `session/request_permission` requests keyed by the
    /// VAC approval id (ULID generated on inbound). X.5c.1.
    pub pending_approvals: dashmap::DashMap<String, PendingApproval>,
    /// Default permission timeout for this agent (from agents.toml).
    pub permission_timeout_ms: u64,
    /// X.5c.2 correlation: toolCallId → resolved approval (primary).
    pub(crate) approval_by_tool_call_id: dashmap::DashMap<String, ResolvedApprovalCacheEntry>,
    /// X.5c.2 correlation: approval_tool_call_hash → resolved approval
    /// (fallback for when the agent rotates / omits toolCallId).
    pub(crate) approval_by_full_hash: dashmap::DashMap<String, ResolvedApprovalCacheEntry>,
    /// X.5c.2 audit sink. None disables the tool.* audit rows.
    pub(crate) audit: Option<Arc<crate::audit::AuditFacility>>,
    /// ACP wire tap for debug logging and `acp.debug_message` emission.
    pub(crate) debug: Option<Arc<AcpDebugLog>>,
}

const APPROVAL_CORRELATION_TTL: std::time::Duration = std::time::Duration::from_secs(60);

impl AcpRuntime {
    /// Insert a freshly-resolved approval into both correlation maps.
    /// Called from `SessionHandle::resolve_approval` on success.
    /// Stale entries are swept on the next lookup.
    fn record_resolved_approval(&self, approval_id: &str, tool_call: &serde_json::Value) {
        let expires_at = tokio::time::Instant::now() + APPROVAL_CORRELATION_TTL;
        let entry = ResolvedApprovalCacheEntry {
            approval_id: approval_id.to_string(),
            expires_at,
        };
        if let Some(tcid) = tool_call.get("toolCallId").and_then(|v| v.as_str()) {
            self.approval_by_tool_call_id
                .insert(tcid.to_string(), entry.clone());
        }
        let hash = sha256_hex_canonical_excluding(tool_call, TOOL_CALL_HASH_DROP_FIELDS);
        self.approval_by_full_hash.insert(hash, entry);
    }

    /// Lookup correlation by primary key, then fallback. Returns the
    /// approval_id if a non-expired entry matches. Sweeps any expired
    /// entries it touches.
    fn correlate_approval(
        &self,
        tool_call_id: &str,
        approval_tool_call_hash: Option<&str>,
    ) -> Option<String> {
        let now = tokio::time::Instant::now();
        if let Some(e) = self.approval_by_tool_call_id.get(tool_call_id) {
            if e.expires_at > now {
                return Some(e.approval_id.clone());
            }
            drop(e);
            self.approval_by_tool_call_id.remove(tool_call_id);
        }
        if let Some(h) = approval_tool_call_hash {
            if let Some(e) = self.approval_by_full_hash.get(h) {
                if e.expires_at > now {
                    return Some(e.approval_id.clone());
                }
                drop(e);
                self.approval_by_full_hash.remove(h);
            }
        }
        None
    }
}

pub struct SessionHandle {
    pub id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent_id: String,
    pub agent_kind: AgentKind,
    /// Workflow spec id and display name for the session's WorkflowProcess.
    pub workflow_spec_id: String,
    pub workflow_spec_name: String,
    pub state: Arc<StateHolder>,
    pub ring: Arc<RwLock<EventRing<ServerEvent>>>,
    /// Stdin for Mock / VacNative engines (legacy JSON-RPC notification
    /// dialect). `None` for ACP — `acp.client` owns its own stdin.
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub broadcast: broadcast::Sender<ServerEvent>,
    /// ACP runtime state when this session is backed by an ACP agent.
    pub acp: Option<Arc<AcpRuntime>>,
    /// Bridge audit sink, shared across ACP and JSON-RPC sessions.
    pub audit: Option<Arc<crate::audit::AuditFacility>>,
    assessment_validation: Arc<Mutex<AssessmentValidationTracker>>,
}

pub struct SpawnOptions {
    pub session_id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub agent: AgentDefinition,
    /// Optional audit sink. When present, the X.5c.2 tool-activity
    /// path writes `tool.observed` / `tool.updated` / `tool.failed`
    /// rows. None on legacy back-compat shims and on JSON-RPC
    /// engines that don't emit ACP tool activity yet.
    pub audit: Option<Arc<crate::audit::AuditFacility>>,
    /// Workflow spec id to use for this session's WorkflowProcess.
    /// When `None`, the registry default is used.
    pub workflow_id: Option<String>,
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

        // Resolve workflow spec. Unknown ids are rejected upstream at the
        // translator layer; this branch hard-errors to guard internal callers.
        let (workflow_spec, workflow_spec_id, workflow_spec_name) = {
            use crate::workflows::WorkflowRegistry;
            let reg = WorkflowRegistry::global();
            let default_id = WorkflowRegistry::default_build_spec_id();
            match opts.workflow_id.as_deref() {
                Some(wid) => {
                    let spec = reg.get(wid).cloned().ok_or_else(|| {
                        anyhow::anyhow!("workflow.not_found: '{wid}' is not a bundled workflow")
                    })?;
                    let name = spec.metadata.name.clone();
                    (Some(spec), wid.to_string(), name)
                }
                None => {
                    let spec = reg.get(default_id).cloned();
                    let name = spec
                        .as_ref()
                        .map(|s| s.metadata.name.clone())
                        .unwrap_or_default();
                    (spec, default_id.to_string(), name)
                }
            }
        };

        let handle = Arc::new(Self {
            id: opts.session_id.clone(),
            profile_id: opts.profile_id.clone(),
            project_root: opts.project_root.clone(),
            agent_id: opts.agent.id.clone(),
            agent_kind: opts.agent.kind,
            workflow_spec_id,
            workflow_spec_name,
            state: Arc::clone(&state),
            ring: Arc::clone(&ring),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            broadcast: bcast_tx.clone(),
            acp: None,
            audit: opts.audit.clone(),
            assessment_validation: Arc::new(Mutex::new(AssessmentValidationTracker::default())),
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

        // Spawn VIL-style workflow process for this session.
        if let Some(spec) = workflow_spec {
            use crate::workflows::process::start_workflow_process;
            start_workflow_process(
                handle.id.clone(),
                Arc::clone(&ring),
                bcast_tx.clone(),
                bcast_tx.subscribe(),
                spec,
            );
        }

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
        // Emit internal workflow signal so WorkflowProcess can react to prompt input.
        // ClientCommand is not broadcast to the session ring, so we emit a namespaced
        // internal event here. WorkflowProcess ignores workflow.* self-events.
        if cmd.cmd_type == "message.submit" {
            emit_to(
                &self.ring,
                &self.broadcast,
                ServerEvent {
                    seq: 0,
                    session_id: self.id.clone(),
                    event_type: "workflow.input.message_submit".into(),
                    payload: serde_json::json!({ "cmd_type": "message.submit" }),
                    v: 1,
                    ts: chrono::Utc::now().to_rfc3339(),
                },
            )
            .await;
        }
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

fn acp_debug_enabled() -> bool {
    matches!(
        std::env::var("VAC_WEB_ACP_DEBUG").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
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
    match method {
        "assessment.candidate_received" => {
            handle_assessment_candidate(handle, &params, method).await;
        }
        "assessment.finding_added" => {
            emit_passthrough_event(
                handle,
                "assessment.finding_added",
                params,
                "assessment.finding_added",
            )
            .await;
        }
        "assessment.evidence_attached" => {
            emit_passthrough_event(
                handle,
                "assessment.evidence_attached",
                params,
                "assessment.evidence_attached",
            )
            .await;
        }
        "assessment.finding" => {
            emit_passthrough_event(
                handle,
                "assessment.finding_added",
                params,
                "assessment.finding",
            )
            .await;
        }
        "assessment.evidence" => {
            emit_passthrough_event(
                handle,
                "assessment.evidence_attached",
                params,
                "assessment.evidence",
            )
            .await;
        }
        _ => {
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
    }
}

async fn emit_passthrough_event(
    handle: &SessionHandleRef,
    event_type: &str,
    payload: serde_json::Value,
    source_event_type: &str,
) {
    let payload = augment_payload(
        payload,
        &[("source_event_type", serde_json::json!(source_event_type))],
    );
    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: event_type.to_string(),
        payload,
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    emit_event(handle, event).await;
}

async fn handle_assessment_candidate(
    handle: &SessionHandleRef,
    params: &serde_json::Value,
    source_event_type: &str,
) {
    let Some(run_id) = extract_string(params, &["run_id", "runId"]) else {
        warn!(
            session = %handle.id,
            source_event_type,
            "assessment candidate missing run_id"
        );
        return;
    };

    let candidates = extract_candidates(params);
    if candidates.is_empty() {
        warn!(
            session = %handle.id,
            run_id = %run_id,
            source_event_type,
            "assessment candidate payload carried no candidates"
        );
        return;
    }

    let batch_hash = sha256_hex_canonical(params);
    let received_event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: "assessment.candidate_received".into(),
        payload: serde_json::json!({
            "run_id": run_id,
            "candidate_hash": batch_hash,
            "candidate_count": candidates.len(),
            "source_event_type": source_event_type,
            "agent_id": handle.agent_id,
            "agent_kind": handle.agent_kind.as_str(),
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    emit_event(handle, received_event).await;

    for candidate in candidates {
        let candidate_hash = sha256_hex_canonical(&candidate);
        let validation = {
            let mut tracker = handle.assessment_validation.lock().await;
            validate_candidate(
                &handle.project_root,
                &mut tracker,
                &run_id,
                &candidate,
                source_event_type,
            )
        };

        match validation {
            Ok(validated) => {
                emit_validated_candidate(
                    handle,
                    &run_id,
                    source_event_type,
                    &candidate_hash,
                    validated,
                )
                .await
            }
            Err(rejection) => {
                emit_candidate_rejection(
                    handle,
                    &run_id,
                    source_event_type,
                    &candidate_hash,
                    rejection,
                )
                .await
            }
        }
    }
}

async fn emit_validated_candidate(
    handle: &SessionHandleRef,
    run_id: &str,
    source_event_type: &str,
    candidate_hash: &str,
    validated: CandidateFinding,
) {
    let CandidateFinding {
        title,
        summary,
        finding_event,
        evidence_events,
        ..
    } = validated;

    let finding_id = finding_event
        .get("finding_id")
        .and_then(|v| v.as_str())
        .unwrap_or("fnd_unknown")
        .to_string();

    for evidence in evidence_events {
        let payload = augment_payload(
            evidence,
            &[
                ("run_id", serde_json::json!(run_id)),
                ("candidate_hash", serde_json::json!(candidate_hash)),
                ("source_event_type", serde_json::json!(source_event_type)),
                ("agent_id", serde_json::json!(handle.agent_id)),
                ("agent_kind", serde_json::json!(handle.agent_kind.as_str())),
                ("finding_id", serde_json::json!(finding_id)),
            ],
        );
        let event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "assessment.evidence_attached".into(),
            payload,
            v: 1,
            ts: chrono::Utc::now().to_rfc3339(),
        };
        emit_event(handle, event).await;
    }

    let payload = augment_payload(
        finding_event,
        &[
            ("run_id", serde_json::json!(run_id)),
            ("candidate_hash", serde_json::json!(candidate_hash)),
            ("source_event_type", serde_json::json!(source_event_type)),
            ("agent_id", serde_json::json!(handle.agent_id)),
            ("agent_kind", serde_json::json!(handle.agent_kind.as_str())),
        ],
    );
    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: "assessment.finding_added".into(),
        payload: payload.clone(),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    emit_event(handle, event).await;

    if let Some(audit) = handle.audit.as_ref() {
        audit.log(
            &handle.id,
            "assessment",
            bridge_core::AuditSeverity::Info,
            serde_json::json!({
                "event": "finding_added",
                "run_id": run_id,
                "candidate_hash": candidate_hash,
                "finding_id": payload.get("finding_id").cloned().unwrap_or(serde_json::Value::Null),
                "identity_hash": payload.get("identity_hash").cloned().unwrap_or(serde_json::Value::Null),
                "title": title,
                "summary": summary,
                "agent_id": handle.agent_id,
                "agent_kind": handle.agent_kind.as_str(),
                "source_event_type": source_event_type,
            }),
        );
    }

    let summary = format!(
        "Validated finding: {}",
        payload
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("candidate")
    );
    let activity = activity_event(
        handle.id.clone(),
        "assessment",
        NotifySeverity::Info,
        &summary,
    );
    emit_event(handle, activity).await;
}

async fn emit_candidate_rejection(
    handle: &SessionHandleRef,
    run_id: &str,
    source_event_type: &str,
    candidate_hash: &str,
    rejection: CandidateRejection,
) {
    let payload = serde_json::json!({
        "run_id": run_id,
        "candidate_hash": candidate_hash,
        "reason": rejection.reason,
        "summary": rejection.summary,
        "source_event_type": source_event_type,
        "agent_id": handle.agent_id,
        "agent_kind": handle.agent_kind.as_str(),
    });
    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: "assessment.candidate_rejected".into(),
        payload: payload.clone(),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    emit_event(handle, event).await;

    if let Some(audit) = handle.audit.as_ref() {
        audit.log(
            &handle.id,
            "assessment",
            bridge_core::AuditSeverity::Warn,
            serde_json::json!({
                "event": "candidate_rejected",
                "run_id": run_id,
                "candidate_hash": candidate_hash,
                "reason": payload.get("reason").cloned().unwrap_or(serde_json::Value::Null),
                "summary": payload.get("summary").cloned().unwrap_or(serde_json::Value::Null),
                "agent_id": handle.agent_id,
                "agent_kind": handle.agent_kind.as_str(),
                "source_event_type": source_event_type,
            }),
        );
    }

    let summary = format!(
        "Rejected candidate: {}",
        payload
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("validation failed")
    );
    let activity = activity_event(
        handle.id.clone(),
        "assessment",
        NotifySeverity::Warn,
        &summary,
    );
    emit_event(handle, activity).await;
}

fn extract_candidates(params: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(arr) = params.get("candidates").and_then(|v| v.as_array()) {
        return arr.clone();
    }
    if let Some(candidate) = params.get("candidate") {
        return vec![candidate.clone()];
    }
    if params
        .as_object()
        .map(|obj| {
            obj.contains_key("title")
                || obj.contains_key("identityHash")
                || obj.contains_key("identity_hash")
        })
        .unwrap_or(false)
    {
        return vec![params.clone()];
    }
    Vec::new()
}

fn extract_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value_at(value, key).and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
    }
    None
}

fn value_at<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value> {
    if let Some((head, tail)) = key.split_once('.') {
        value.get(head).and_then(|child| value_at(child, tail))
    } else {
        value.get(key)
    }
}

fn augment_payload(
    payload: serde_json::Value,
    fields: &[(&str, serde_json::Value)],
) -> serde_json::Value {
    let mut payload = payload;
    let Some(obj) = payload.as_object_mut() else {
        return payload;
    };
    for (k, v) in fields {
        obj.insert((*k).to_string(), v.clone());
    }
    payload
}

impl SessionHandle {
    /// Stage X.5b — official ACP path. Spawn the agent binary, run
    /// `initialize`, open a session via `session/new`, and start a
    /// task that pumps `session/update` notifications into VAC events.
    /// CLI args follow `agent.args` *only* — no `--profile/--session-id/
    /// --project` because the ACP client conveys cwd via
    /// `session/new.params.cwd`.
    async fn spawn_acp(opts: SpawnOptions) -> anyhow::Result<SessionHandleRef> {
        let debug = AcpDebugLog::new(acp_debug_enabled());
        let (client, mut child) = AcpClient::spawn(
            &opts.agent.command,
            &opts.agent.args,
            &[],
            Some(Arc::clone(&debug)),
        )?;

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
        let permission_rx = client.take_permission_receiver().await;
        let acp_runtime = Arc::new(AcpRuntime {
            client,
            acp_session_id: acp_session_id.clone(),
            pending_approvals: dashmap::DashMap::new(),
            permission_timeout_ms: opts.agent.permission_timeout_ms,
            approval_by_tool_call_id: dashmap::DashMap::new(),
            approval_by_full_hash: dashmap::DashMap::new(),
            audit: opts.audit.clone(),
            debug: Some(Arc::clone(&debug)),
        });

        // Resolve workflow spec. Unknown ids are rejected upstream at the
        // translator layer; this branch hard-errors to guard internal callers.
        let (workflow_spec_acp, workflow_spec_id_acp, workflow_spec_name_acp) = {
            use crate::workflows::WorkflowRegistry;
            let reg = WorkflowRegistry::global();
            let default_id = WorkflowRegistry::default_build_spec_id();
            match opts.workflow_id.as_deref() {
                Some(wid) => {
                    let spec = reg.get(wid).cloned().ok_or_else(|| {
                        anyhow::anyhow!("workflow.not_found: '{wid}' is not a bundled workflow")
                    })?;
                    let name = spec.metadata.name.clone();
                    (Some(spec), wid.to_string(), name)
                }
                None => {
                    let spec = reg.get(default_id).cloned();
                    let name = spec
                        .as_ref()
                        .map(|s| s.metadata.name.clone())
                        .unwrap_or_default();
                    (spec, default_id.to_string(), name)
                }
            }
        };

        let handle = Arc::new(Self {
            id: opts.session_id.clone(),
            profile_id: opts.profile_id.clone(),
            project_root: opts.project_root.clone(),
            agent_id: opts.agent.id.clone(),
            agent_kind: opts.agent.kind,
            workflow_spec_id: workflow_spec_id_acp,
            workflow_spec_name: workflow_spec_name_acp,
            state: Arc::clone(&state),
            ring: Arc::clone(&ring),
            stdin: Arc::new(Mutex::new(None)),
            broadcast: bcast_tx.clone(),
            acp: Some(Arc::clone(&acp_runtime)),
            audit: opts.audit.clone(),
            assessment_validation: Arc::new(Mutex::new(AssessmentValidationTracker::default())),
        });

        if let Some(debug) = acp_runtime.debug.as_ref() {
            debug
                .attach_session(
                    handle.id.clone(),
                    Arc::clone(&handle.ring),
                    handle.broadcast.clone(),
                )
                .await;
        }

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

        // Stage X.5c.1 — pump session/request_permission requests
        // into the bridge's approval queue. For each request:
        //   1. Mint a VAC approvalId (ULID) and stash the
        //      acp_request_id + options + toolCall in pending_approvals.
        //   2. Schedule an auto-cancel timer keyed on
        //      permission_timeout_ms; when it fires, the bridge sends
        //      `{outcome:"cancelled"}` and removes the entry.
        //   3. Emit `approval.pending` ServerEvent with the approvalId
        //      and the agent's payload so the web surface can render.
        if let Some(mut perm_rx) = permission_rx {
            let perm_handle = Arc::clone(&handle);
            tokio::spawn(async move {
                while let Some(req) = perm_rx.recv().await {
                    handle_permission_request(&perm_handle, req).await;
                }
                info!(session = %perm_handle.id, "ACP permission channel closed");
            });
        }

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

        // Spawn VIL-style workflow process for this session.
        if let Some(spec) = workflow_spec_acp {
            use crate::workflows::process::start_workflow_process;
            start_workflow_process(
                handle.id.clone(),
                Arc::clone(&ring),
                bcast_tx.clone(),
                bcast_tx.subscribe(),
                spec,
            );
        }

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
        "tool_call" | "tool_call_update" => {
            map_tool_activity(handle, &notif).await;
        }
        other => {
            tracing::debug!(
                session = %handle.id,
                variant = %other,
                "ACP session/update variant ignored at X.5c.2 scope"
            );
        }
    }
}

/// X.5c.2 — normalize a `tool_call` / `tool_call_update`
/// notification into an `ObservedToolActivity` and emit the
/// per-kind VAC events.
///
/// Observe-only: this function never blocks the agent, never
/// mutates the wire, and never enables fs/terminal capabilities.
/// It surfaces what the agent already did.
async fn map_tool_activity(handle: &SessionHandleRef, notif: &SessionNotification) {
    let raw_params = serde_json::json!({
        "sessionId": notif.session_id,
        "update": notif.update,
    });
    let Some(mut activity) = extract_observed_tool_activity(
        &handle.id,
        &handle.agent_id,
        handle.agent_kind,
        &raw_params,
        DEFAULT_RAW_OUTPUT_CAP_BYTES,
    ) else {
        return;
    };

    // Attach approved_by_approval_id when correlation hits.
    if let Some(acp) = handle.acp.as_ref() {
        if let Some(approval_id) = acp.correlate_approval(
            &activity.tool_call_id,
            activity.approval_tool_call_hash.as_deref(),
        ) {
            activity.approved_by_approval_id = Some(approval_id);
        }
    }

    let event_type = match activity.status {
        ToolStatus::Failed => "tool.failed",
        ToolStatus::Pending => "tool.observed",
        _ => "tool.updated",
    };
    let payload = serde_json::to_value(&activity).unwrap_or(serde_json::Value::Null);
    let ts = chrono::Utc::now().to_rfc3339();
    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: event_type.into(),
        payload: payload.clone(),
        v: 1,
        ts: ts.clone(),
    };
    emit_event(handle, event).await;

    // X.5c.2 audit row. Severity: Info for observed/updated; Warn for
    // failed (NEVER Error — task-level failure is not bridge crash).
    if let Some(acp) = handle.acp.as_ref() {
        if let Some(audit) = acp.audit.as_ref() {
            let severity = match activity.status {
                ToolStatus::Failed => bridge_core::AuditSeverity::Warn,
                _ => bridge_core::AuditSeverity::Info,
            };
            let audit_fields = serde_json::json!({
                "event": event_type,
                "toolCallId": activity.tool_call_id,
                "kind": payload.get("kind").cloned().unwrap_or(serde_json::Value::Null),
                "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
                "locations": activity.locations,
                "approval_tool_call_hash": activity.approval_tool_call_hash,
                "raw_input_hash": activity.raw_input_hash,
                "approved_by_approval_id": activity.approved_by_approval_id,
                "agent_id": activity.agent_id,
                "agent_kind": activity.agent_kind.as_str(),
            });
            audit.log(&handle.id, "tool", severity, audit_fields);
        }
    }

    // Edit-kind activity also drives Review.
    // Render only when we have either real locations or actual diff
    // entries — pure-pending tool_call (no content yet) carries
    // neither and shouldn't pollute the Review surface.
    if matches!(activity.kind, ToolKind::Edit)
        && (!activity.locations.is_empty() || !activity.diffs.is_empty())
    {
        let review_payload = serde_json::json!({
            "tool_call_id": activity.tool_call_id,
            "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
            "locations": activity.locations,
            "diffs": activity.diffs,
            "raw_input_redacted": activity.raw_input_redacted,
            "approved_by_approval_id": activity.approved_by_approval_id,
            "agent_id": activity.agent_id,
            "agent_kind": activity.agent_kind.as_str(),
        });
        let review_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "review.changeset_updated".into(),
            payload: review_payload,
            v: 1,
            ts: ts.clone(),
        };
        emit_event(handle, review_event).await;
    }

    // Execute-kind activity drives Runtime as a job log line.
    // Skip the initial pending tool_call (no rawInput / rawOutput
    // yet) so the runtime stream only carries useful payloads.
    if matches!(activity.kind, ToolKind::Execute) && !matches!(activity.status, ToolStatus::Pending)
    {
        let cmd = activity
            .raw_input_redacted
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let runtime_payload = serde_json::json!({
            "tool_call_id": activity.tool_call_id,
            "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
            "command": cmd,
            "output": activity.raw_output_redacted,
            "approved_by_approval_id": activity.approved_by_approval_id,
            "agent_id": activity.agent_id,
            "agent_kind": activity.agent_kind.as_str(),
        });
        let runtime_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "runtime.job_log".into(),
            payload: runtime_payload,
            v: 1,
            ts,
        };
        emit_event(handle, runtime_event).await;
    }
}

// X.5c will use this to surface json-rpc protocol errors as typed acks.
#[allow(dead_code)]
fn classify_for_ack(e: &crate::agent_runtime::acp::JsonRpcError) -> &'static str {
    classify_jsonrpc_error(e)
}

/// X.5c.1 — receive a `session/request_permission`, register a pending
/// approval, schedule an auto-cancel timer, and emit `approval.pending`
/// to the broadcast.
async fn handle_permission_request(handle: &SessionHandleRef, req: PermissionRequest) {
    let Some(acp) = handle.acp.clone() else {
        warn!("permission request on non-ACP session — dropping");
        return;
    };
    let approval_id = format!("appr_{}", ulid::Ulid::new());
    let options = req
        .params
        .get("options")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tool_call = req
        .params
        .get("toolCall")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    // Auto-cancel timer.
    let acp_for_timer = Arc::clone(&acp);
    let approval_id_for_timer = approval_id.clone();
    let acp_request_id = req.id;
    let timeout_ms = acp.permission_timeout_ms;
    let handle_for_timer = Arc::clone(handle);
    let timer = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(timeout_ms)).await;
        // Only fire if still pending.
        if acp_for_timer
            .pending_approvals
            .remove(&approval_id_for_timer)
            .is_some()
        {
            warn!(
                approval_id = %approval_id_for_timer,
                "permission auto-cancelled after timeout"
            );
            let outcome = serde_json::json!({ "outcome": { "outcome": "cancelled" } });
            let _ = acp_for_timer
                .client
                .respond_permission(acp_request_id, outcome);
            let event = ServerEvent {
                seq: 0,
                session_id: handle_for_timer.id.clone(),
                event_type: "approval.resolved".into(),
                payload: serde_json::json!({
                    "approval_id": approval_id_for_timer,
                    "outcome": "timeout",
                }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            };
            emit_event(&handle_for_timer, event).await;
        }
    });
    let timer_handle = Arc::new(timer.abort_handle());

    acp.pending_approvals.insert(
        approval_id.clone(),
        PendingApproval {
            acp_request_id,
            options: options.clone(),
            tool_call: tool_call.clone(),
            created_at: chrono::Utc::now(),
            timeout_handle: timer_handle,
        },
    );

    let event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: "approval.pending".into(),
        payload: serde_json::json!({
            "approval_id": approval_id,
            "tool_call": tool_call,
            "options": options,
            "expires_in_ms": timeout_ms,
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    emit_event(handle, event).await;
}

/// Approve / reject intent — drives kind validation when an explicit
/// `option_id` is supplied by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalIntent {
    Approve,
    Reject,
}

/// Typed resolution failure so the translator can map to stable ack
/// codes without string sniffing.
#[derive(Debug, thiserror::Error)]
pub enum ApprovalResolveError {
    #[error("approval on non-ACP session")]
    NotAcp,
    #[error("approval not found: {0}")]
    NotFound(String),
    #[error("no approve/reject option available in pending options")]
    NoEligibleOption,
    #[error("approval option_id `{0}` not found in pending options")]
    OptionNotFound(String),
    #[error(
        "approval option_id `{option_id}` (kind `{kind}`) does not match the {intent:?} intent"
    )]
    OptionKindMismatch {
        option_id: String,
        kind: String,
        intent: ApprovalIntent,
    },
    #[error("approval option_id `{0}` is forbidden by bridge policy (allow_always not enabled)")]
    OptionForbidden(String),
    #[error("acp transport: {0}")]
    Transport(String),
}

/// Result of a successful approve / reject resolution. Carries enough
/// data for the translator to write a complete audit row.
#[derive(Debug, Clone)]
pub struct ApprovalResolution {
    pub option_id: String,
    /// The full option object (preserves `kind`, `name`, `_meta`, …).
    pub option: serde_json::Value,
    /// The original `toolCall` payload from the agent's
    /// `session/request_permission` request.
    pub tool_call: serde_json::Value,
}

/// Stage X.5c.1 policy gate. Persistent-permission options
/// (`allow_always`) are not yet wired to a per-profile policy, so the
/// bridge default is to refuse them. When the policy plane lands this
/// becomes a profile/agent lookup.
const PERSISTENT_PERMISSION_ALLOWED: bool = false;

impl SessionHandle {
    /// X.5c.1 — resolve a pending ACP approval as APPROVED.
    ///
    /// If the caller supplies `explicit_option_id`, the bridge:
    /// - confirms it exists in `pending.options`,
    /// - confirms its `kind` is an `allow_*` variant,
    /// - rejects `allow_always` unless persistent permission is on.
    ///
    /// Otherwise the policy default picker chooses `allow_once` first.
    pub async fn resolve_approval_approve(
        &self,
        approval_id: &str,
        explicit_option_id: Option<&str>,
    ) -> Result<ApprovalResolution, ApprovalResolveError> {
        self.resolve_approval(approval_id, explicit_option_id, ApprovalIntent::Approve)
            .await
    }

    /// X.5c.1 — resolve a pending ACP approval as REJECTED. Same
    /// validation rules as approve, but `kind` must start with
    /// `reject`.
    pub async fn resolve_approval_reject(
        &self,
        approval_id: &str,
        explicit_option_id: Option<&str>,
    ) -> Result<ApprovalResolution, ApprovalResolveError> {
        self.resolve_approval(approval_id, explicit_option_id, ApprovalIntent::Reject)
            .await
    }

    async fn resolve_approval(
        &self,
        approval_id: &str,
        explicit_option_id: Option<&str>,
        intent: ApprovalIntent,
    ) -> Result<ApprovalResolution, ApprovalResolveError> {
        let acp = self.acp.as_ref().ok_or(ApprovalResolveError::NotAcp)?;

        // X.5c.1 hardening: validate the option *before* removing the
        // pending entry or aborting its timeout. A bad override must
        // not strip timeout protection from a still-held permission
        // request — otherwise an invalid attempt followed by user
        // silence leaves the agent waiting forever.
        // Clone only what `resolve_option` needs; the DashMap read
        // guard is released at the end of this scope, well before any
        // await.
        let options_snapshot = {
            let entry = acp
                .pending_approvals
                .get(approval_id)
                .ok_or_else(|| ApprovalResolveError::NotFound(approval_id.to_string()))?;
            entry.options.clone()
        };
        let chosen = resolve_option(&options_snapshot, explicit_option_id, intent)?;

        // Validation passed — now remove + abort. If the entry
        // disappeared between the get() and the remove() (e.g. the
        // timer fired or another concurrent resolve won the race),
        // surface NotFound so the caller doesn't double-resolve.
        let (_, pending) = acp
            .pending_approvals
            .remove(approval_id)
            .ok_or_else(|| ApprovalResolveError::NotFound(approval_id.to_string()))?;
        pending.timeout_handle.abort();

        let outcome = serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": chosen.option_id }
        });
        acp.client
            .respond_permission(pending.acp_request_id, outcome)
            .map_err(|e| ApprovalResolveError::Transport(e.to_string()))?;

        let outcome_label = match intent {
            ApprovalIntent::Approve => "approved",
            ApprovalIntent::Reject => "rejected",
        };
        // X.5c.2 — only populate the correlation cache for approvals
        // that actually let the tool run. Rejected resolutions don't
        // get a "approved by you" badge on subsequent activity.
        if matches!(intent, ApprovalIntent::Approve) {
            acp.record_resolved_approval(approval_id, &pending.tool_call);
        }
        let resolution = ApprovalResolution {
            option_id: chosen.option_id.clone(),
            option: chosen.option,
            tool_call: pending.tool_call.clone(),
        };
        let event = ServerEvent {
            seq: 0,
            session_id: self.id.clone(),
            event_type: "approval.resolved".into(),
            payload: serde_json::json!({
                "approval_id": approval_id,
                "outcome": outcome_label,
                "option_id": resolution.option_id,
            }),
            v: 1,
            ts: chrono::Utc::now().to_rfc3339(),
        };
        emit_to(&self.ring, &self.broadcast, event).await;
        Ok(resolution)
    }
}

struct ChosenOption {
    option_id: String,
    option: serde_json::Value,
}

fn resolve_option(
    options: &[serde_json::Value],
    explicit: Option<&str>,
    intent: ApprovalIntent,
) -> Result<ChosenOption, ApprovalResolveError> {
    let chosen_id = match explicit {
        Some(id) => id.to_string(),
        None => match intent {
            ApprovalIntent::Approve => pick_approve_option_id(options)
                .map_err(|_| ApprovalResolveError::NoEligibleOption)?,
            ApprovalIntent::Reject => pick_reject_option_id(options)
                .map_err(|_| ApprovalResolveError::NoEligibleOption)?,
        },
    };
    let option = options
        .iter()
        .find(|o| o.get("optionId").and_then(|v| v.as_str()) == Some(&chosen_id))
        .ok_or_else(|| ApprovalResolveError::OptionNotFound(chosen_id.clone()))?
        .clone();
    let kind = option
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let kind_ok = match intent {
        ApprovalIntent::Approve => kind.starts_with("allow"),
        ApprovalIntent::Reject => kind.starts_with("reject"),
    };
    if !kind_ok {
        return Err(ApprovalResolveError::OptionKindMismatch {
            option_id: chosen_id,
            kind,
            intent,
        });
    }
    if kind == "allow_always" && !PERSISTENT_PERMISSION_ALLOWED {
        return Err(ApprovalResolveError::OptionForbidden(chosen_id));
    }
    Ok(ChosenOption {
        option_id: chosen_id,
        option,
    })
}

/// Policy-aware option picker. Prefer `allow_once` over `allow_always`
/// so the bridge doesn't accidentally grant persistent permission when
/// the user just clicks Approve once. If neither is present, fall back
/// to the first non-reject option.
fn pick_approve_option_id(options: &[serde_json::Value]) -> anyhow::Result<String> {
    let id_for = |kind: &str| -> Option<String> {
        options
            .iter()
            .find(|o| o.get("kind").and_then(|k| k.as_str()) == Some(kind))
            .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
            .map(String::from)
    };
    if let Some(id) = id_for("allow_once") {
        return Ok(id);
    }
    if let Some(id) = id_for("allow_always") {
        return Ok(id);
    }
    // Last resort: first option whose kind doesn't start with "reject".
    options
        .iter()
        .find(|o| {
            o.get("kind")
                .and_then(|k| k.as_str())
                .map(|s| !s.starts_with("reject"))
                .unwrap_or(false)
        })
        .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("no approve-eligible option in {options:?}"))
}

fn pick_reject_option_id(options: &[serde_json::Value]) -> anyhow::Result<String> {
    let id_for = |kind: &str| -> Option<String> {
        options
            .iter()
            .find(|o| o.get("kind").and_then(|k| k.as_str()) == Some(kind))
            .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
            .map(String::from)
    };
    if let Some(id) = id_for("reject_once") {
        return Ok(id);
    }
    if let Some(id) = id_for("reject_always") {
        return Ok(id);
    }
    options
        .iter()
        .find(|o| {
            o.get("kind")
                .and_then(|k| k.as_str())
                .map(|s| s.starts_with("reject"))
                .unwrap_or(false)
        })
        .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("no reject-eligible option in {options:?}"))
}

#[cfg(test)]
mod approval_picker_tests {
    use super::{pick_approve_option_id, pick_reject_option_id};
    use serde_json::json;

    fn opts() -> Vec<serde_json::Value> {
        vec![
            json!({"kind":"allow_always","optionId":"AA"}),
            json!({"kind":"allow_once","optionId":"AO"}),
            json!({"kind":"reject_once","optionId":"RO"}),
        ]
    }

    #[test]
    fn approve_prefers_allow_once_over_allow_always() {
        assert_eq!(pick_approve_option_id(&opts()).unwrap(), "AO");
    }

    #[test]
    fn approve_falls_back_to_allow_always_when_only_persistent_offered() {
        let only_persistent = vec![
            json!({"kind":"allow_always","optionId":"AA"}),
            json!({"kind":"reject_once","optionId":"RO"}),
        ];
        assert_eq!(pick_approve_option_id(&only_persistent).unwrap(), "AA");
    }

    #[test]
    fn reject_prefers_reject_once_over_reject_always() {
        let with_persistent_reject = vec![
            json!({"kind":"reject_always","optionId":"RA"}),
            json!({"kind":"reject_once","optionId":"RO"}),
        ];
        assert_eq!(
            pick_reject_option_id(&with_persistent_reject).unwrap(),
            "RO"
        );
    }

    #[test]
    fn reject_errors_when_no_reject_option() {
        let no_reject = vec![json!({"kind":"allow_once","optionId":"AO"})];
        assert!(pick_reject_option_id(&no_reject).is_err());
    }
}
