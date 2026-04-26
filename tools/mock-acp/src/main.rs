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
    /// X.5c.2 deterministic emit flags. When set, every
    /// `session/prompt` first emits a scripted tool_call /
    /// tool_call_update sequence and then completes the prompt.
    /// At most one of these should be set per run.
    emit_read_tool: bool,
    emit_edit_tool: bool,
    emit_execute_tool: bool,
    emit_failed_tool: bool,
    /// When set, scripted tool_call_update emits an oversized
    /// rawOutput (~200 KB) so the bridge's bounded-output helper is
    /// exercised end-to-end.
    oversized_output: bool,
    /// When set in combination with --permission-prompt, the
    /// scripted tool_call/tool_call_update use a *different*
    /// toolCallId than the request_permission carried, so the
    /// bridge must fall back to approval_tool_call_hash for
    /// X.5c.2 correlation.
    rotate_tool_call_id: bool,
    /// When set, after a permission for one toolCall is approved,
    /// the agent emits a *different* tool_call (different
    /// toolCallId, different `kind`/title — therefore different
    /// approval_tool_call_hash) whose only overlap with the
    /// approved one is `rawInput`. Used by the negative
    /// correlation test.
    same_raw_input_different_tool: bool,
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
            "--emit-read-tool" => a.emit_read_tool = true,
            "--emit-edit-tool" => a.emit_edit_tool = true,
            "--emit-execute-tool" => a.emit_execute_tool = true,
            "--emit-failed-tool" => a.emit_failed_tool = true,
            "--oversized-output" => a.oversized_output = true,
            "--rotate-tool-call-id" => a.rotate_tool_call_id = true,
            "--same-raw-input-different-tool" => a.same_raw_input_different_tool = true,
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
                    // X.5c.2 — the permission's toolCallId becomes the
                    // anchor for downstream tool_call notifications;
                    // when --rotate-tool-call-id or
                    // --same-raw-input-different-tool is set, the
                    // scripted tool deliberately uses a different id.
                    let perm_tool_call_id: &str = "tc_perm";
                    if args_clone.permission_prompt {
                        let outcome = match request_permission_round_trip(
                            &stdout_emit,
                            &session_id,
                            &pending_outbound_e,
                            &outbound_next_id_e,
                            perm_tool_call_id,
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
                                        "toolCallId": perm_tool_call_id,
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

                    // X.5c.2 — scripted tool_call sequences. Optional;
                    // emitted before the regular agent_message_chunk
                    // stream so tests can assert on the
                    // ObservedToolActivity surface independently.
                    emit_scripted_tool(&args_clone, &stdout_emit, &session_id, perm_tool_call_id)
                        .await;

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
    tool_call_id: &str,
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
                "toolCallId": tool_call_id,
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

/// X.5c.2 scripted tool emit. Called once per `session/prompt` if any
/// `--emit-*-tool` flag is set. Determines the toolCallId based on
/// `--rotate-tool-call-id` / `--same-raw-input-different-tool` so
/// tests can assert correlation paths.
async fn emit_scripted_tool(
    args: &Args,
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    perm_tool_call_id: &str,
) {
    if !(args.emit_read_tool
        || args.emit_edit_tool
        || args.emit_execute_tool
        || args.emit_failed_tool)
    {
        return;
    }

    // Pick the toolCallId for downstream notifications.
    let scripted_tool_call_id = if args.rotate_tool_call_id || args.same_raw_input_different_tool {
        "tc_after"
    } else if args.permission_prompt {
        perm_tool_call_id
    } else {
        "tc_script"
    };

    if args.emit_read_tool {
        emit_read_sequence(stdout, session_id, scripted_tool_call_id).await;
    }
    if args.emit_edit_tool {
        // Three shapes:
        //   --rotate-tool-call-id only:
        //     mirror permission's exact toolCall shape (Mock Tool,
        //     /tmp/mock, content "x"). Only the toolCallId differs,
        //     so approval_tool_call_hash matches → positive fallback.
        //   --same-raw-input-different-tool:
        //     rawInput matches verbatim, but title/locations differ.
        //     approval_tool_call_hash differs → negative correlation
        //     (proves raw_input alone isn't a key).
        //   neither:
        //     fresh shape, no permission overlap.
        let (title, raw_input, edit_path) =
            if args.rotate_tool_call_id && !args.same_raw_input_different_tool {
                (
                    "Mock Tool",
                    json!({ "file_path": "/tmp/mock", "content": "x" }),
                    "/tmp/mock",
                )
            } else if args.same_raw_input_different_tool {
                (
                    "Different Tool With Same RawInput",
                    json!({ "file_path": "/tmp/mock", "content": "x" }),
                    "/repo/elsewhere.md",
                )
            } else {
                (
                    "Write hello.md",
                    json!({ "file_path": "/repo/hello.md", "content": "hi from script" }),
                    "/repo/hello.md",
                )
            };
        emit_edit_sequence(
            stdout,
            session_id,
            scripted_tool_call_id,
            title,
            &raw_input,
            edit_path,
            args.oversized_output,
        )
        .await;
    }
    if args.emit_execute_tool {
        emit_execute_sequence(
            stdout,
            session_id,
            scripted_tool_call_id,
            args.oversized_output,
        )
        .await;
    }
    if args.emit_failed_tool {
        emit_failed_sequence(stdout, session_id, scripted_tool_call_id).await;
    }
}

async fn emit_read_sequence(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    tool_call_id: &str,
) {
    let pending = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": tool_call_id,
                "kind": "read",
                "title": "Read File",
                "status": "pending",
                "content": [],
                "locations": []
            }
        }
    });
    let _ = writeln_json(stdout, &pending).await;
    let completed = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_call_id,
                "kind": "read",
                "status": "completed",
                "locations": [{ "path": "/repo/notes.txt", "line": 1 }],
                "rawInput": { "file_path": "/repo/notes.txt" },
                "rawOutput": "hello world\nthis is line two\n"
            }
        }
    });
    let _ = writeln_json(stdout, &completed).await;
}

async fn emit_edit_sequence(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    tool_call_id: &str,
    title: &str,
    raw_input: &Value,
    edit_path: &str,
    oversized: bool,
) {
    let path = edit_path;
    let new_text = raw_input
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let pending = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": tool_call_id,
                "kind": "edit",
                "title": "Write",
                "status": "pending",
                "content": [],
                "locations": []
            }
        }
    });
    let _ = writeln_json(stdout, &pending).await;
    let with_diff = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_call_id,
                "kind": "edit",
                "title": title,
                "status": "in_progress",
                "locations": [{ "path": path }],
                "content": [{
                    "type": "diff",
                    "path": path,
                    "newText": new_text,
                    "oldText": null
                }],
                "rawInput": raw_input
            }
        }
    });
    let _ = writeln_json(stdout, &with_diff).await;
    let raw_output = if oversized {
        Value::String("y".repeat(200_000))
    } else {
        Value::String("File written".into())
    };
    let completed = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_call_id,
                "kind": "edit",
                "status": "completed",
                "rawOutput": raw_output
            }
        }
    });
    let _ = writeln_json(stdout, &completed).await;
}

async fn emit_execute_sequence(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    tool_call_id: &str,
    oversized: bool,
) {
    // Inject an Anthropic-style key into the rawOutput so X.5c.2's
    // redact_raw_output is exercised end-to-end. Even when oversized
    // is false the key is present at the end.
    let secret_marker = "sk-ant-1234567890abcdef0000abcdef";
    let pending = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": tool_call_id,
                "kind": "execute",
                "title": "Bash",
                "status": "pending",
                "content": [],
                "locations": []
            }
        }
    });
    let _ = writeln_json(stdout, &pending).await;
    let raw_output = if oversized {
        let mut s = "z".repeat(200_000);
        s.push(' ');
        s.push_str(secret_marker);
        Value::String(s)
    } else {
        Value::String(format!("hello from real bash\n{secret_marker}\n"))
    };
    let completed = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_call_id,
                "kind": "execute",
                "status": "completed",
                "rawInput": {
                    "command": "echo hello from real bash",
                    "API_KEY": "leaky-secret"
                },
                "rawOutput": raw_output
            }
        }
    });
    let _ = writeln_json(stdout, &completed).await;
}

async fn emit_failed_sequence(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    session_id: &str,
    tool_call_id: &str,
) {
    let failed = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_call_id,
                "kind": "edit",
                "status": "failed",
                "rawOutput": "User refused permission to run tool",
                "content": [{
                    "type": "content",
                    "content": { "type": "text", "text": "denied" }
                }]
            }
        }
    });
    let _ = writeln_json(stdout, &failed).await;
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
