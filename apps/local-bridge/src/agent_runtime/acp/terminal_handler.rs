//! ACP `terminal/*` client method handlers. Manages terminal lifecycle
//! with shell enforcement from the session's capability profile.

use dashmap::DashMap;
use profile_core::enforce::{enforce_shell, Decision};
use profile_core::profile::CapabilityProfile;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

const MAX_OUTPUT_READ_BYTES: usize = 64 * 1024;

/// Per-terminal state shared between the wait/kill task and the
/// `terminal/output` / `terminal/wait_for_exit` / `terminal/kill`
/// handlers.
///
/// Audit Sprint 2 P1 fix: previously `child` lived in `Mutex<Option<Child>>`
/// but was always `None` because the wait task owned the real `Child`.
/// `kill` therefore returned `success` without actually killing the
/// process. Now a single owner-task holds the `Child` and listens on
/// `kill_rx` for kill requests, calling `Child::start_kill()` from
/// inside the same task. Handlers signal kill via `kill_tx`.
pub struct TerminalHandle {
    /// Send `()` to request the owner-task SIGKILL the child. The
    /// channel is unbounded but we only ever push at most a handful of
    /// kill signals per terminal, so this is fine.
    kill_tx: mpsc::UnboundedSender<()>,
    stdout_buf: Arc<Mutex<Vec<u8>>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_notify: Arc<tokio::sync::Notify>,
    /// Set to `true` once the owner-task has observed a kill signal.
    /// Used so `wait_for_exit` can surface a sentinel non-zero exit
    /// code (137 — SIGKILL semantics) when the OS doesn't report a
    /// signal-derived code.
    // Held only so the wait task's Arc clone keeps the flag
    // alive for the lifetime of the handle. Read from the wait
    // task only; clippy's dead_code lint flags struct-side reads
    // separately.
    #[allow(dead_code)]
    killed: Arc<AtomicBool>,
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
    let killed = Arc::new(AtomicBool::new(false));

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

    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();
    let exit_code_clone = Arc::clone(&exit_code);
    let exit_notify_clone = Arc::clone(&exit_notify);
    let killed_clone = Arc::clone(&killed);

    // Single owner-task: holds the `Child`, polls `wait()`, and handles
    // kill signals via `tokio::select!`. Dropping the half-completed
    // `wait()` future on a kill branch is safe — the OS-level child
    // state lives on `Child` itself, so we just re-await on the next
    // loop iteration after `start_kill()`.
    tokio::spawn(async move {
        loop {
            tokio::select! {
                res = child.wait() => {
                    match res {
                        Ok(status) => {
                            let raw = status.code();
                            let code = match raw {
                                Some(c) => c,
                                None => {
                                    // Killed by signal — surface 137
                                    // (SIGKILL convention) when we
                                    // requested it, otherwise -1.
                                    if killed_clone.load(Ordering::SeqCst) { 137 } else { -1 }
                                }
                            };
                            *exit_code_clone.lock().await = Some(code);
                        }
                        Err(e) => {
                            warn!(error=%e, "terminal child wait failed");
                            *exit_code_clone.lock().await = Some(-1);
                        }
                    }
                    exit_notify_clone.notify_waiters();
                    break;
                }
                Some(()) = kill_rx.recv() => {
                    killed_clone.store(true, Ordering::SeqCst);
                    if let Err(e) = child.start_kill() {
                        warn!(error=%e, "terminal start_kill failed");
                    }
                    // Loop continues; next iteration awaits wait()
                    // which should return promptly now that SIGKILL
                    // has been delivered.
                }
            }
        }
    });

    let terminal_id = ulid::Ulid::new().to_string();

    let handle = Arc::new(TerminalHandle {
        kill_tx,
        stdout_buf,
        exit_code,
        exit_notify,
        killed,
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

    // Fast path: if the owner-task already recorded an exit code, skip
    // the notify wait — `Notify::notify_waiters()` only wakes current
    // waiters, so a late `wait_for_exit` could otherwise hang for the
    // full timeout against an already-finished child.
    if handle.exit_code.lock().await.is_some() {
        let code = handle.exit_code.lock().await;
        return Ok(json!({ "exitCode": code.unwrap_or(-1) }));
    }

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

    // Audit-Sprint-2 P1 fix: signal the owner-task to actually SIGKILL
    // the child. If `send` fails the owner-task has already exited,
    // which means the child has already terminated; treat that as
    // success.
    let _ = handle.kill_tx.send(());

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

    fn allow(bin: &str) -> ShellAllowEntry {
        ShellAllowEntry {
            bin: bin.into(),
            args_pattern: None,
            max_args: 10,
            cwd_scope: None,
            timeout_ms: 60_000,
            env_allowlist: vec![],
            output_cap_bytes: 2_097_152,
        }
    }

    #[tokio::test]
    async fn create_allowed_command_succeeds() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), vec![allow("echo")]);
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
        let ctx = test_ctx(dir.path(), vec![allow("echo")]);
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

    /// Audit Sprint 2 P1 regression test: spawn a long-running process,
    /// kill it, and confirm `wait_for_exit` returns promptly (well
    /// before the natural sleep duration) with a non-zero exit code.
    /// Before the fix, kill was a no-op and this test would have
    /// timed out at ~30s.
    #[tokio::test]
    async fn create_kill_long_running_process_completes_promptly() {
        let dir = TempDir::new().unwrap();
        let ctx = test_ctx(dir.path(), vec![allow("sleep")]);
        let create_params = json!({ "command": "sleep", "args": ["30"] });
        let created = handle_terminal_create(&ctx, &create_params).await.unwrap();
        let tid = created["terminalId"].as_str().unwrap().to_string();

        // Give the child a moment to actually start before we kill it.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let kill_params = json!({ "terminalId": tid });
        let kill_result = handle_terminal_kill(&ctx, &kill_params).await.unwrap();
        assert_eq!(kill_result["success"], true);

        // wait_for_exit must complete in well under the sleep 30s
        // duration. Allow generous 5s slack for slow CI hosts.
        let wait_params = json!({ "terminalId": tid, "timeoutMs": 5_000 });
        let started = std::time::Instant::now();
        let wait_result = handle_terminal_wait_for_exit(&ctx, &wait_params)
            .await
            .unwrap();
        let elapsed = started.elapsed();
        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "wait_for_exit took {elapsed:?}; kill is likely a no-op"
        );
        let exit_code = wait_result["exitCode"].as_i64().unwrap();
        assert_ne!(
            exit_code, 0,
            "killed sleep should not exit cleanly, got exit_code={exit_code}"
        );
    }
}
