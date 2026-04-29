//! ACP `terminal/*` client method handlers. Manages terminal lifecycle
//! with shell enforcement from the session's capability profile.

use dashmap::DashMap;
use profile_core::enforce::{enforce_shell, Decision};
use profile_core::profile::CapabilityProfile;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{info, warn};

const MAX_OUTPUT_READ_BYTES: usize = 64 * 1024;

pub struct TerminalHandle {
    child: Mutex<Option<tokio::process::Child>>,
    stdout_buf: Arc<Mutex<Vec<u8>>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_notify: Arc<tokio::sync::Notify>,
}

/// Context for terminal request handling.
#[derive(Clone)]
pub struct TerminalHandlerContext {
    pub project_root: PathBuf,
    pub profile: CapabilityProfile,
    pub session_id: String,
    pub agent_id: String,
    pub terminals: Arc<DashMap<String, Arc<TerminalHandle>>>,
    pub audit: Option<Arc<crate::audit::AuditFacility>>,
}

#[derive(Debug)]
pub enum TerminalError {
    MissingParam(&'static str),
    ProfileDenied { reason: String, code: String },
    NotFound(String),
    SpawnFailed(std::io::Error),
    AlreadyExited,
    Timeout,
    MethodNotFound(String),
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TerminalError::MissingParam(p) => write!(f, "missing param: {p}"),
            TerminalError::ProfileDenied { reason, .. } => write!(f, "denied: {reason}"),
            TerminalError::NotFound(id) => write!(f, "terminal not found: {id}"),
            TerminalError::SpawnFailed(e) => write!(f, "spawn failed: {e}"),
            TerminalError::AlreadyExited => write!(f, "terminal already exited"),
            TerminalError::Timeout => write!(f, "wait timed out"),
            TerminalError::MethodNotFound(m) => write!(f, "unknown terminal method: {m}"),
        }
    }
}

impl TerminalError {
    pub fn jsonrpc_code(&self) -> i64 {
        match self {
            TerminalError::MissingParam(_) => -32602,
            TerminalError::ProfileDenied { .. }
            | TerminalError::NotFound(_)
            | TerminalError::SpawnFailed(_)
            | TerminalError::AlreadyExited
            | TerminalError::Timeout
            | TerminalError::MethodNotFound(_) => -32603,
        }
    }

    pub fn jsonrpc_data(&self) -> Value {
        match self {
            TerminalError::ProfileDenied { code, reason } => {
                json!({ "code": code, "reason": reason })
            }
            _ => json!({ "detail": self.to_string() }),
        }
    }
}

pub async fn handle_terminal_create(
    ctx: &TerminalHandlerContext,
    params: &Value,
) -> Result<Value, TerminalError> {
    let command = params
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or(TerminalError::MissingParam("command"))?;
    let args: Vec<&str> = params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    match enforce_shell(&ctx.profile, command, &args) {
        Decision::Allow => {}
        Decision::Deny { reason, code } => {
            return Err(TerminalError::ProfileDenied {
                reason,
                code: code.to_string(),
            });
        }
    }

    let mut cmd = Command::new(command);
    cmd.args(&args)
        .current_dir(&ctx.project_root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(TerminalError::SpawnFailed)?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let exit_code: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));
    let exit_notify = Arc::new(tokio::sync::Notify::new());

    let buf_clone = Arc::clone(&stdout_buf);
    if let Some(mut out) = stdout {
        tokio::spawn(async move {
            let mut tmp = [0u8; 4096];
            loop {
                match out.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut buf = buf_clone.lock().await;
                        let remaining = MAX_OUTPUT_READ_BYTES.saturating_sub(buf.len());
                        if remaining > 0 {
                            buf.extend_from_slice(&tmp[..n.min(remaining)]);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let buf_clone2 = Arc::clone(&stdout_buf);
    if let Some(mut err) = stderr {
        tokio::spawn(async move {
            let mut tmp = [0u8; 4096];
            loop {
                match err.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut buf = buf_clone2.lock().await;
                        let remaining = MAX_OUTPUT_READ_BYTES.saturating_sub(buf.len());
                        if remaining > 0 {
                            buf.extend_from_slice(&tmp[..n.min(remaining)]);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let exit_code_clone = Arc::clone(&exit_code);
    let exit_notify_clone = Arc::clone(&exit_notify);
    let child_mutex = Mutex::new(Some(child));

    {
        let child_ref = Arc::new(child_mutex);
        let child_ref2 = Arc::clone(&child_ref);
        tokio::spawn(async move {
            let mut guard = child_ref2.lock().await;
            if let Some(ref mut c) = *guard {
                match c.wait().await {
                    Ok(status) => {
                        *exit_code_clone.lock().await = status.code();
                    }
                    Err(e) => {
                        warn!(error=%e, "terminal child wait failed");
                    }
                }
            }
            exit_notify_clone.notify_waiters();
        });

        let terminal_id = ulid::Ulid::new().to_string();

        let handle = Arc::new(TerminalHandle {
            child: Mutex::new(None), // child is owned by wait task above
            stdout_buf,
            exit_code,
            exit_notify,
        });

        ctx.terminals.insert(terminal_id.clone(), handle);

        if let Some(audit) = &ctx.audit {
            audit.log(
                &ctx.session_id,
                "terminal.create",
                bridge_core::AuditSeverity::Info,
                json!({
                    "agent_id": ctx.agent_id,
                    "terminal_id": terminal_id,
                    "command": command,
                    "args": args,
                }),
            );
        }

        info!(
            session = %ctx.session_id,
            terminal_id = %terminal_id,
            command = command,
            "terminal/create served"
        );

        Ok(json!({ "terminalId": terminal_id }))
    }
}

pub async fn handle_terminal_output(
    ctx: &TerminalHandlerContext,
    params: &Value,
) -> Result<Value, TerminalError> {
    let terminal_id = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or(TerminalError::MissingParam("terminalId"))?;

    let handle = ctx
        .terminals
        .get(terminal_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| TerminalError::NotFound(terminal_id.to_string()))?;

    let buf = handle.stdout_buf.lock().await;
    let output = String::from_utf8_lossy(&buf).to_string();

    Ok(json!({ "output": output }))
}

pub async fn handle_terminal_wait_for_exit(
    ctx: &TerminalHandlerContext,
    params: &Value,
) -> Result<Value, TerminalError> {
    let terminal_id = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or(TerminalError::MissingParam("terminalId"))?;

    let handle = ctx
        .terminals
        .get(terminal_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| TerminalError::NotFound(terminal_id.to_string()))?;

    let timeout_ms = params
        .get("timeoutMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(30_000);

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        handle.exit_notify.notified(),
    )
    .await;

    if result.is_err() {
        return Err(TerminalError::Timeout);
    }

    let code = handle.exit_code.lock().await;
    Ok(json!({ "exitCode": code.unwrap_or(-1) }))
}

pub async fn handle_terminal_kill(
    ctx: &TerminalHandlerContext,
    params: &Value,
) -> Result<Value, TerminalError> {
    let terminal_id = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or(TerminalError::MissingParam("terminalId"))?;

    let handle = ctx
        .terminals
        .get(terminal_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| TerminalError::NotFound(terminal_id.to_string()))?;

    let mut child_guard = handle.child.lock().await;
    if let Some(ref mut child) = *child_guard {
        let _ = child.kill().await;
    }

    if let Some(audit) = &ctx.audit {
        audit.log(
            &ctx.session_id,
            "terminal.kill",
            bridge_core::AuditSeverity::Info,
            json!({
                "agent_id": ctx.agent_id,
                "terminal_id": terminal_id,
            }),
        );
    }

    Ok(json!({ "success": true }))
}

pub async fn handle_terminal_release(
    ctx: &TerminalHandlerContext,
    params: &Value,
) -> Result<Value, TerminalError> {
    let terminal_id = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or(TerminalError::MissingParam("terminalId"))?;

    let removed = ctx.terminals.remove(terminal_id);
    if removed.is_none() {
        return Err(TerminalError::NotFound(terminal_id.to_string()));
    }

    if let Some(audit) = &ctx.audit {
        audit.log(
            &ctx.session_id,
            "terminal.release",
            bridge_core::AuditSeverity::Info,
            json!({
                "agent_id": ctx.agent_id,
                "terminal_id": terminal_id,
            }),
        );
    }

    info!(
        session = %ctx.session_id,
        terminal_id = terminal_id,
        "terminal/release served"
    );

    Ok(json!({ "success": true }))
}

pub fn build_terminal_context(
    profile: &CapabilityProfile,
    project_root: &Path,
    session_id: &str,
    agent_id: &str,
    audit: Option<Arc<crate::audit::AuditFacility>>,
) -> TerminalHandlerContext {
    TerminalHandlerContext {
        project_root: project_root.to_path_buf(),
        profile: profile.clone(),
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string(),
        terminals: Arc::new(DashMap::new()),
        audit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use profile_core::profile::{FsConfig, ShellAllowEntry};
    use tempfile::TempDir;

    fn test_profile_with_shell(allowlist: Vec<ShellAllowEntry>) -> CapabilityProfile {
        CapabilityProfile {
            id: "test".into(),
            class: profile_core::profile::Class::Executor,
            version: "1.0.0".into(),
            description: None,
            inherits_from: None,
            tool_allow: vec![],
            tool_deny: vec![],
            shell_allowlist: allowlist,
            fs: FsConfig::default(),
            git: Default::default(),
            connectors: Default::default(),
            network_egress: Default::default(),
            approval_required_for: vec![],
            allowed_agent_kinds: vec!["acp".into()],
            resource_limits: None,
            audit: None,
        }
    }

    fn test_ctx(project_root: &Path, allowlist: Vec<ShellAllowEntry>) -> TerminalHandlerContext {
        TerminalHandlerContext {
            project_root: project_root.to_path_buf(),
            profile: test_profile_with_shell(allowlist),
            session_id: "test-session".into(),
            agent_id: "test-agent".into(),
            terminals: Arc::new(DashMap::new()),
            audit: None,
        }
    }

    #[tokio::test]
    async fn create_allowed_command_succeeds() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(
            dir.path(),
            vec![ShellAllowEntry {
                bin: "echo".into(),
                args_pattern: None,
                max_args: 10,
                cwd_scope: None,
                timeout_ms: 15000,
                env_allowlist: vec![],
                output_cap_bytes: 2_097_152,
            }],
        );
        let params = json!({ "command": "echo", "args": ["hello"] });
        let result = handle_terminal_create(&ctx, &params).await.unwrap();
        assert!(result.get("terminalId").is_some());
    }

    #[tokio::test]
    async fn create_disallowed_command_denied() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), vec![]);
        let params = json!({ "command": "rm", "args": ["-rf", "/"] });
        let err = handle_terminal_create(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, TerminalError::ProfileDenied { .. }));
    }

    #[tokio::test]
    async fn output_nonexistent_terminal_errors() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), vec![]);
        let params = json!({ "terminalId": "nonexistent" });
        let err = handle_terminal_output(&ctx, &params).await.unwrap_err();
        assert!(matches!(err, TerminalError::NotFound(_)));
    }

    #[tokio::test]
    async fn release_removes_terminal() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(
            dir.path(),
            vec![ShellAllowEntry {
                bin: "echo".into(),
                args_pattern: None,
                max_args: 10,
                cwd_scope: None,
                timeout_ms: 15000,
                env_allowlist: vec![],
                output_cap_bytes: 2_097_152,
            }],
        );
        let params = json!({ "command": "echo", "args": ["hi"] });
        let result = handle_terminal_create(&ctx, &params).await.unwrap();
        let tid = result["terminalId"].as_str().unwrap();

        let release_params = json!({ "terminalId": tid });
        let result = handle_terminal_release(&ctx, &release_params)
            .await
            .unwrap();
        assert_eq!(result["success"], true);

        let err = handle_terminal_output(&ctx, &release_params)
            .await
            .unwrap_err();
        assert!(matches!(err, TerminalError::NotFound(_)));
    }
}
