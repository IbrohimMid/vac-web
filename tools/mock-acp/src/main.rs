//! mock-acp — minimal ACP-speaking stdio child for Stage X.5b tests.
//!
//! After Stage X.5b the bridge speaks the official Agent Client
//! Protocol (`@agentclientprotocol/sdk@0.20+`). This binary mirrors the
//! tiny subset the bridge needs in tests:
//!
//!   client → agent: `initialize` → `session/new` → `session/prompt`
//!   agent → client: `session/update` notifications + final
//!                   `session/prompt` response.
//!
//! Wire is JSON-RPC 2.0 over line-delimited JSON. stderr is for
//! debug logs. Real `claude-agent-acp` provides the production agent;
//! mock-acp keeps the X.3-style integration tests offline-friendly.
//!
//! Behavior:
//!   - On `initialize`, replies with `protocolVersion=1` and a small
//!     `agentCapabilities` set.
//!   - On `session/new`, replies with a deterministic `sessionId`.
//!   - On every `session/prompt`, emits 3 `agent_message_chunk`
//!     notifications then resolves the prompt with
//!     `stop_reason="end_turn"`.
//!   - On `session/cancel`, marks the current prompt cancelled.
//!   - `--crash-after <n>` makes the child exit non-zero after `n`
//!     total chunks emitted, exercising X.3 watchdog handling.
//!   - Unknown methods → JSON-RPC `-32601`.

use anyhow::Result;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

#[derive(Debug, Default)]
struct Args {
    crash_after: Option<u32>,
    cli_passthrough: bool,
}

fn parse_args() -> Args {
    let mut a = Args::default();
    let mut argv = std::env::args().skip(1);
    while let Some(tok) = argv.next() {
        match tok.as_str() {
            "--acp" | "--stdio" => {}
            "--crash-after" => a.crash_after = argv.next().and_then(|v| v.parse().ok()),
            // Tolerate the legacy CLI-arg shape so old code paths can
            // still exec the binary without choking.
            "--profile" | "--session-id" | "--project" => {
                let _ = argv.next();
                a.cli_passthrough = true;
            }
            _ => {}
        }
    }
    a
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("VAC_MOCK_ACP_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = parse_args();
    info!(?args, "mock-acp starting (real ACP wire)");

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));

    let total_chunks = Arc::new(AtomicU32::new(0));
    let cancelled = Arc::new(AtomicBool::new(false));

    loop {
        let line = match tokio::time::timeout(Duration::from_secs(3600), reader.next_line()).await {
            Ok(Ok(Some(l))) => l,
            Ok(Ok(None)) => {
                info!("stdin EOF, exiting");
                return Ok(());
            }
            Ok(Err(e)) => {
                warn!(error = %e, "stdin read error");
                return Err(e.into());
            }
            Err(_) => {
                warn!("idle timeout");
                return Ok(());
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, raw = %line, "non-JSON input ignored");
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "initialize" => {
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": 1,
                        "agentCapabilities": {
                            "promptCapabilities": { "image": false, "embeddedContext": true },
                            "mcpCapabilities": { "http": false, "sse": false },
                            "loadSession": false,
                            "sessionCapabilities": {}
                        },
                        "agentInfo": {
                            "name": "mock-acp",
                            "title": "Mock ACP",
                            "version": env!("CARGO_PKG_VERSION")
                        },
                        "authMethods": []
                    }
                });
                writeln_json(&stdout, &resp).await?;
            }
            "session/new" => {
                let cwd = params
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/")
                    .to_string();
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "sessionId": format!("mock_acp_{}", short_hash(&cwd)),
                        "modes": null,
                        "models": null,
                        "configOptions": null
                    }
                });
                writeln_json(&stdout, &resp).await?;
            }
            "session/prompt" => {
                let session_id = params
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let prompt_text = params
                    .get("prompt")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|b| b.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                cancelled.store(false, Ordering::SeqCst);

                let stdout_emit = Arc::clone(&stdout);
                let total_chunks_e = Arc::clone(&total_chunks);
                let cancelled_e = Arc::clone(&cancelled);
                let crash_after = args.crash_after;
                let prompt_id = id.clone();

                tokio::spawn(async move {
                    for chunk in echo_chunks(&prompt_text) {
                        if cancelled_e.load(Ordering::SeqCst) {
                            break;
                        }
                        let notif = json!({
                            "jsonrpc": "2.0",
                            "method": "session/update",
                            "params": {
                                "sessionId": session_id,
                                "update": {
                                    "sessionUpdate": "agent_message_chunk",
                                    "content": { "type": "text", "text": chunk }
                                }
                            }
                        });
                        if writeln_json(&stdout_emit, &notif).await.is_err() {
                            return;
                        }
                        let n = total_chunks_e.fetch_add(1, Ordering::SeqCst) + 1;
                        if let Some(cap) = crash_after {
                            if n >= cap {
                                warn!(total_chunks = n, "crash-after threshold; exiting non-zero");
                                std::process::exit(7);
                            }
                        }
                    }
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": prompt_id,
                        "result": {
                            "stopReason": if cancelled_e.load(Ordering::SeqCst) {
                                "cancelled"
                            } else {
                                "end_turn"
                            },
                            "usage": { "inputTokens": 1, "outputTokens": 1, "totalTokens": 2 }
                        }
                    });
                    let _ = writeln_json(&stdout_emit, &resp).await;
                });
            }
            "session/cancel" => {
                cancelled.store(true, Ordering::SeqCst);
                debug!("prompt cancelled");
                // Notification — no response.
            }
            other => {
                if id.is_some() {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32601,
                            "message": format!("\"Method not found\": {other}"),
                            "data": { "method": other }
                        }
                    });
                    writeln_json(&stdout, &resp).await?;
                } else {
                    debug!(?other, "unhandled notification");
                }
            }
        }
    }
}

async fn writeln_json(out: &Arc<Mutex<tokio::io::Stdout>>, v: &Value) -> Result<()> {
    let s = serde_json::to_string(v)?;
    let mut g = out.lock().await;
    g.write_all(s.as_bytes()).await?;
    g.write_all(b"\n").await?;
    g.flush().await?;
    Ok(())
}

fn echo_chunks(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec!["ack".into()];
    }
    let trimmed: String = text.chars().take(120).collect();
    let third = (trimmed.len() / 3).max(1);
    let mut out = Vec::with_capacity(3);
    let mut start = 0usize;
    while start < trimmed.len() && out.len() < 3 {
        let mut end = (start + third).min(trimmed.len());
        while end < trimmed.len() && !trimmed.is_char_boundary(end) {
            end += 1;
        }
        out.push(trimmed[start..end].to_string());
        start = end;
    }
    if out.is_empty() {
        out.push(trimmed);
    }
    out
}

fn short_hash(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())[..8].to_string()
}
