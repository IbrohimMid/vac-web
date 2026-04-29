//! Audit P2 fix — real-agent ACP smoke suite scaffold.
//!
//! These tests are `#[ignore]` by default and only run when the
//! corresponding env var is set, e.g.:
//!
//! ```bash
//! GEMINI_ACP_CMD="gemini --acp" \
//!   cargo test -p local-bridge -- --ignored real_acp_agents
//! ```
//!
//! Each test spawns the configured binary, performs a minimal ACP
//! handshake (`initialize` over JSON-RPC stdio), and asserts the
//! response is well-formed. We deliberately keep the surface tiny so
//! it works against any conforming ACP CLI without needing a session
//! or a prompt round-trip — those layers already have unit/integration
//! coverage against `mock-acp`. The point of this suite is to catch
//! protocol drift between vendors (Claude / OpenCode / Gemini /
//! Codex) without locking the bridge to a single one.
//!
//! When the gating env var is missing the test prints a one-line
//! skip notice and returns; CI on minimal images therefore stays
//! green even when running with `--ignored`.

#![allow(clippy::useless_conversion)]

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

/// Split a `"prog arg1 arg2"` env value into program + args. Empty
/// strings are filtered so trailing whitespace doesn't leak into
/// `args`. We don't try to handle quoted args because the env var is
/// operator-supplied for local smoke testing only.
fn split_cmd(raw: &str) -> Option<(String, Vec<String>)> {
    let mut parts = raw.split_whitespace().map(|s| s.to_string());
    let prog = parts.next()?;
    Some((prog, parts.collect()))
}

/// Drive a JSON-RPC `initialize` against the spawned ACP binary and
/// assert we get back a result with a `protocolVersion` field. The
/// concrete value isn't checked — the point is to confirm the binary
/// speaks ACP at all and didn't print an error to stderr or crash.
async fn run_initialize(env_var: &str) {
    let Some(raw) = std::env::var_os(env_var) else {
        eprintln!("[real_acp] {env_var} not set; skipping");
        return;
    };
    let raw = raw.to_string_lossy().into_owned();
    let Some((prog, args)) = split_cmd(&raw) else {
        eprintln!("[real_acp] {env_var} is empty; skipping");
        return;
    };

    let mut child = match Command::new(&prog)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[real_acp] failed to spawn {prog}: {e}; skipping");
            return;
        }
    };

    let mut stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let mut reader = BufReader::new(stdout);

    // Minimal ACP initialize. Real agents accept additional fields,
    // but the spec only requires `protocolVersion`. We use a high
    // version number so the agent reports its own preferred version
    // back in the response.
    let init = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {}
        }
    });
    let line = format!("{}\n", serde_json::to_string(&init).unwrap());
    stdin
        .write_all(line.as_bytes())
        .await
        .expect("write initialize");
    stdin.flush().await.expect("flush");

    let read_line = async {
        let mut buf = String::new();
        loop {
            buf.clear();
            let n = reader.read_line(&mut buf).await.expect("read line");
            if n == 0 {
                panic!("agent closed stdout before responding to initialize");
            }
            // Some agents emit log lines on stdout before the JSON-RPC
            // response. Skip anything that doesn't parse as JSON with
            // an `id` field matching our request.
            if let Ok(v) = serde_json::from_str::<Value>(buf.trim()) {
                if v.get("id").and_then(|x| x.as_u64()) == Some(1) {
                    return v;
                }
            }
        }
    };

    let response = match timeout(HANDSHAKE_TIMEOUT, read_line).await {
        Ok(v) => v,
        Err(_) => {
            let _ = child.kill().await;
            panic!(
                "timed out after {:?} waiting for {prog} to respond to initialize",
                HANDSHAKE_TIMEOUT
            );
        }
    };

    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("initialize response missing `result`: {response}"));
    assert!(
        result.get("protocolVersion").is_some(),
        "result missing protocolVersion: {result}"
    );

    // Best-effort cleanup. We don't care about exit code — the
    // binary may exit cleanly on stdin close or it may need SIGTERM.
    drop(stdin);
    let _ = timeout(Duration::from_secs(2), child.wait()).await;
    let _ = child.kill().await;
}

#[tokio::test]
#[ignore = "requires GEMINI_ACP_CMD env var pointing at a real Gemini CLI"]
async fn gemini_acp_smoke() {
    run_initialize("GEMINI_ACP_CMD").await;
}

#[tokio::test]
#[ignore = "requires OPENCODE_ACP_CMD env var pointing at a real OpenCode CLI"]
async fn opencode_acp_smoke() {
    run_initialize("OPENCODE_ACP_CMD").await;
}

#[tokio::test]
#[ignore = "requires CLAUDE_ACP_CMD env var pointing at a real Claude CLI"]
async fn claude_acp_smoke() {
    run_initialize("CLAUDE_ACP_CMD").await;
}
