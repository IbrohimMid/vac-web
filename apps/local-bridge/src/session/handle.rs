//! Per-session state + child process handle.

use crate::ws::envelope::ServerEvent;
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
    pub state: Arc<StateHolder>,
    pub ring: Arc<RwLock<EventRing<ServerEvent>>>,
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub broadcast: broadcast::Sender<ServerEvent>,
}

pub struct SpawnOptions {
    pub session_id: String,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub engine_bin: PathBuf,
}

impl SessionHandle {
    /// Spawn child engine process (mock-engine or vac serve) + wire stdio.
    pub async fn spawn(opts: SpawnOptions) -> anyhow::Result<SessionHandleRef> {
        let mut child: Child = Command::new(&opts.engine_bin)
            .arg("--stdio")
            .arg("--profile")
            .arg(&opts.profile_id)
            .arg("--session-id")
            .arg(&opts.session_id)
            .arg("--project")
            .arg(&opts.project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

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
            state: Arc::clone(&state),
            ring: Arc::clone(&ring),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            broadcast: bcast_tx.clone(),
        });

        state.transition(bridge_core::SessionState::Ready).ok();

        // Pump stderr to tracing.
        let sid_err = handle.id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                tracing::debug!(session = %sid_err, "engine_stderr: {l}");
            }
        });

        // Pump stdout → ring + broadcast.
        let handle_clone = Arc::clone(&handle);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                process_stdout_line(&line, &handle_clone).await;
            }
            info!(session = %handle_clone.id, "engine stdout closed");
            let _ = handle_clone
                .state
                .transition(bridge_core::SessionState::Closing);
            let _ = handle_clone
                .state
                .transition(bridge_core::SessionState::Closed);
        });

        // Spawn watchdog: when child exits, transition state.
        let handle_wait = Arc::clone(&handle);
        tokio::spawn(async move {
            let status = child.wait().await;
            info!(session = %handle_wait.id, status = ?status, "child exited");
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

    pub async fn close_stdin(&self) {
        let _ = self.stdin.lock().await.take();
    }
}

async fn process_stdout_line(line: &str, handle: &SessionHandleRef) {
    // Engine emits JSON-RPC notifications. Translator maps method → protocol v1 event.
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

    // Simple pass-through event.
    let event_type = method.to_string();
    let event = ServerEvent {
        seq: 0, // assigned by ring
        session_id: handle.id.clone(),
        event_type,
        payload: params,
        v: 1,
        ts,
    };

    let seq = {
        let mut ring = handle.ring.write().await;
        ring.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = handle.broadcast.send(with_seq);
}
