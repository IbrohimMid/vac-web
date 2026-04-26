//! mock-acp — minimal ACP-speaking stdio child for Stage X.5b/X.5c.1 tests.
//!
//! Speaks the official Agent Client Protocol over JSON-RPC 2.0 + ndjson.
//! Implements just enough of the Agent side to drive bridge tests:
//!
//!   client → agent: `initialize`, `session/new`, `session/prompt`,
//!                   `session/cancel`
//!   agent → client: `session/update` notifications, `session/prompt`
//!                   final response, and (in --permission-prompt mode)
//!                   an outbound `session/request_permission` request.
//!
//! Flags:
//!   --acp / --stdio          tolerated for legacy spawn shapes
//!   --crash-after <n>        exit non-zero after n total chunks
//!   --bad-session-prompt     every session/prompt returns -32603
//!                            "Session not found" (X.5b classifier test)
//!   --permission-prompt      every session/prompt issues an outbound
//!                            session/request_permission first; happy
//!                            path on `selected/allow_*`, failed
//!                            `tool_call_update` on `selected/reject_*`
//!                            or `cancelled`.
//!
//! Real `claude-agent-acp` is the production agent; mock-acp keeps the
//! integration tests offline-friendly.

use anyhow::Result;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};
use tracing::{debug, info, warn};

#[derive(Debug, Default)]
struct Args {
    crash_after: Option<u32>,
    cli_passthrough: bool,
    bad_session_prompt: bool,
    permission_prompt: bool,
}

fn parse_args() -> Args {
    let mut a = Args::default();
    let mut argv = std::env::args().skip(1);
    while let Some(tok) = argv.next() {
        match tok.as_str() {
            "--acp" | "--stdio" => {}
            "--crash-after" => a.crash_after = argv.next().and_then(|v| v.parse().ok()),
            "--bad-session-prompt" => a.bad_session_prompt = true,
            "--permission-prompt" => a.permission_prompt = true,
            "--profile" | "--session-id" | "--project" => {
                let _ = argv.next();
                a.cli_passthrough = true;
            }
            _ => {}
        }
    }
    a
}

type PendingOutbound = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("VAC_MOCK_ACP_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Arc::new(parse_args());
    info!(?args, "mock-acp starting (real ACP wire)");

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));

    let total_chunks = Arc::new(AtomicU32::new(0));
    let cancelled = Arc::new(AtomicBool::new(false));
    let pending_outbound: PendingOutbound = Arc::new(Mutex::new(HashMap::new()));
    let outbound_next_id = Arc::new(AtomicU32::new(9000));

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

        // Response to one of OUR outbound requests?
        if method.is_empty() && id.is_some() {
            if let Some(uid) = id.as_ref().and_then(|v| v.as_u64()) {
                let mut p = pending_outbound.lock().await;
                if let Some(tx) = p.remove(&uid) {
                    let _ = tx.send(req.clone());
                    continue;
                }
            }
            debug!("response with no matching outbound request: {req}");
            continue;
        }

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
                if args.bad_session_prompt {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32603,
                            "message": "Internal error",
                            "data": { "details": "Session not found" }
                        }
                    });
                    writeln_json(&stdout, &resp).await?;
                    continue;
                }
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
                let args_clone = Arc::clone(&args);
                let pending_outbound_e = Arc::clone(&pending_outbound);
                let outbound_next_id_e = Arc::clone(&outbound_next_id);

                tokio::spawn(async move {
                    // X.5c.1 — issue session/request_permission first.
                    if args_clone.permission_prompt {
                        let outcome = match request_permission_round_trip(
                            &stdout_emit,
                            &session_id,
                            &pending_outbound_e,
                            &outbound_next_id_e,
                        )
                        .await
                        {
                            Ok(v) => v,
                            Err(e) => {
                                warn!(error=%e, "permission round-trip failed");
                                let resp = json!({
                                    "jsonrpc": "2.0",
                                    "id": prompt_id,
                                    "error": {
                                        "code": -32603,
                                        "message": "Internal error",
                                        "data": { "details": format!("permission round-trip: {e}") }
                                    }
                                });
                                let _ = writeln_json(&stdout_emit, &resp).await;
                                return;
                            }
                        };
                        let outcome_kind = outcome
                            .get("result")
                            .and_then(|r| r.get("outcome"))
                            .and_then(|o| o.get("outcome"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("");
                        let opt_id = outcome
                            .get("result")
                            .and_then(|r| r.get("outcome"))
                            .and_then(|o| o.get("optionId"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("");
                        let approved = outcome_kind == "selected"
                            && (opt_id == "allow" || opt_id == "allow_always");
                        if !approved {
                            // Mirror real claude-agent-acp behavior:
                            // emit a tool_call_update with status=failed
                            // and end the prompt with end_turn.
                            let notif = json!({
                                "jsonrpc": "2.0",
                                "method": "session/update",
                                "params": {
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "tool_call_update",
                                        "toolCallId": "tc_mock",
                                        "status": "failed",
                                        "rawOutput": "User refused permission to run tool",
                                        "content": [{
                                            "type": "content",
                                            "content": { "type": "text", "text": "denied" }
                                        }]
                                    }
                                }
                            });
                            let _ = writeln_json(&stdout_emit, &notif).await;
                            let resp = json!({
                                "jsonrpc": "2.0",
                                "id": prompt_id,
                                "result": {
                                    "stopReason": "end_turn",
                                    "usage": {"inputTokens":1,"outputTokens":1,"totalTokens":2}
                                }
                            });
                            let _ = writeln_json(&stdout_emit, &resp).await;
                            return;
                        }
                    }

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

async fn request_permission_round_trip(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    pending: &PendingOutbound,
    next_id: &Arc<AtomicU32>,
) -> Result<Value> {
    let id = next_id.fetch_add(1, Ordering::SeqCst) as u64;
    let (tx, rx) = oneshot::channel();
    pending.lock().await.insert(id, tx);
    let req = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/request_permission",
        "params": {
            "sessionId": session_id,
            "toolCall": {
                "toolCallId": "tc_mock",
                "kind": "edit",
                "title": "Mock Tool",
                "content": [{ "type":"diff", "path":"/tmp/mock", "newText":"x", "oldText":null }],
                "locations": [{ "path": "/tmp/mock" }],
                "rawInput": { "file_path": "/tmp/mock", "content": "x" }
            },
            "options": [
                { "kind": "allow_always", "name": "Always Allow", "optionId": "allow_always" },
                { "kind": "allow_once",   "name": "Allow",        "optionId": "allow" },
                { "kind": "reject_once",  "name": "Reject",       "optionId": "reject" }
            ]
        }
    });
    writeln_json(stdout, &req).await?;
    let outcome = tokio::time::timeout(Duration::from_secs(30), rx).await??;
    Ok(outcome)
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
