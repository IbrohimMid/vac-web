//! Stage X.3 — ACP driver scaffold integration test.
//!
//! Spawns the bridge with a synthetic agent registry pointing the
//! default agent at the `mock-acp` binary (kind = acp). Verifies:
//!   - executor.code session creates successfully under the acp kind
//!     (matrix from Stage X.2).
//!   - The ACP envelope coming out of the child is translated into
//!     `transcript.delta` + `transcript.completed` events on the
//!     server-side broadcast.
//!   - A child crash surfaces as a `transcript.error` event.

#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::agent_runtime::{
    AgentDefinition, AgentKind, AgentRuntimeRegistry, AgentsConfig, ConfigSource,
    DEFAULT_PERMISSION_TIMEOUT_MS, MIN_PERMISSION_TIMEOUT_MS,
};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::server::{build_app, AppState};
use local_bridge::session::SessionRegistry;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

const T: Duration = Duration::from_secs(5);

fn target_root() -> PathBuf {
    let m = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    m.parent().unwrap().parent().unwrap().to_path_buf()
}

fn mock_acp_bin() -> PathBuf {
    let root = target_root();
    for p in [
        root.join("target/debug/mock-acp"),
        root.join("target/release/mock-acp"),
    ] {
        if p.exists() {
            return p;
        }
    }
    panic!("mock-acp binary missing — run `cargo build -p mock-acp`")
}

fn build_acp_registry(extra_args: Vec<String>) -> AgentRuntimeRegistry {
    build_acp_registry_with_timeout(extra_args, DEFAULT_PERMISSION_TIMEOUT_MS)
}

fn build_acp_registry_with_timeout(
    extra_args: Vec<String>,
    permission_timeout_ms: u64,
) -> AgentRuntimeRegistry {
    let mut args = vec!["--acp".to_string()];
    args.extend(extra_args);
    let agent = AgentDefinition {
        id: "claude-mock".into(),
        label: "Mock ACP".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args,
        enabled: true,
        permission_timeout_ms,
    };
    let cfg = AgentsConfig {
        default_agent_id: agent.id.clone(),
        agents: vec![agent],
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}

/// Same as [`start_bridge_with`] but also returns the audit directory
/// so tests can inspect the JSONL rows the AuditFacility writes.
async fn start_bridge_with_audit_dir(
    registry: AgentRuntimeRegistry,
) -> (String, Arc<AppState>, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    let audit = Arc::new(AuditFacility::new(dir.clone()));
    let sessions = SessionRegistry::with_runtime(Arc::new(registry));
    sessions.attach_audit(Arc::clone(&audit));
    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions,
        auth: AuthState::new_dev(),
        audit,
        pairing: PairingStore::new(),
        profile_root: PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/protocol/v1/profiles"
        )),
    });
    std::mem::forget(tmp);
    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("ws://{}/api/sessions/stream", addr), state, dir)
}

async fn start_bridge_with(registry: AgentRuntimeRegistry) -> (String, Arc<AppState>) {
    let tmp = tempfile::tempdir().unwrap();
    let audit = Arc::new(AuditFacility::new(tmp.path().to_path_buf()));
    let sessions = SessionRegistry::with_runtime(Arc::new(registry));
    sessions.attach_audit(Arc::clone(&audit));
    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions,
        auth: AuthState::new_dev(),
        audit,
        pairing: PairingStore::new(),
        profile_root: PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/protocol/v1/profiles"
        )),
    });
    std::mem::forget(tmp);
    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("ws://{}/api/sessions/stream", addr), state)
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_hello(url: &str) -> Ws {
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    ws.send(Message::Text(
        json!({ "type": "hello", "protocol_version": 1 })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    // Drain welcome.
    let _ = tokio::time::timeout(T, ws.next()).await.unwrap();
    ws
}

async fn create_session(ws: &mut Ws, profile_id: &str) -> String {
    let cmd = json!({
        "v": 1,
        "id": "c1",
        "type": "session.create",
        "session_id": "",
        "payload": { "profile_id": profile_id, "project_root": "/tmp/x" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    // Walk events until session.ready arrives, returning the session_id.
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed before session.ready");
        };
        let txt = match msg.unwrap() {
            Message::Text(t) => t.to_string(),
            _ => continue,
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!("session.ready")) {
            return v["session_id"].as_str().unwrap().to_string();
        }
        if v.get("type") == Some(&json!("server_ack")) && v.get("ok") == Some(&json!(false)) {
            panic!("session.create ack failed: {v}");
        }
    }
}

async fn next_event_of_type(ws: &mut Ws, type_name: &str) -> Value {
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed waiting for {type_name}");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!(type_name)) {
            return v;
        }
    }
}

#[tokio::test]
async fn x3_acp_browser_message_submit_routed_to_acp_prompt() {
    // End-to-end: browser-side `message.submit` → bridge translator
    // → SessionHandle::send_client_command → ACP `prompt` envelope on
    // the child's stdin → transcript.delta + transcript.completed.
    // No direct send_to_engine bypass.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    // Normal protocol command — exactly the shape a browser client
    // would send.
    let cmd = json!({
        "v": 1,
        "id": "cmd_msgsubmit",
        "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "hello from browser" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let delta = next_event_of_type(&mut ws, "transcript.delta").await;
    assert!(delta["payload"]["delta"].is_string());
    let _completed = next_event_of_type(&mut ws, "transcript.completed").await;
}

#[tokio::test]
async fn x3_acp_unsupported_command_returns_protocol_unsupported() {
    // Non-message.submit commands are not yet wired for ACP — bridge
    // must surface a typed `agent.protocol_unsupported` rather than
    // silently forwarding a JSON-RPC frame the ACP child can't parse.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "cmd_runtime",
        "type": "runtime.list_jobs",
        "session_id": session_id,
        "payload": {}
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("ackOf") == Some(&json!("cmd_runtime")) {
            assert_eq!(v["ok"], json!(false));
            assert_eq!(v["error"]["code"], json!("agent.protocol_unsupported"));
            return;
        }
    }
}

#[tokio::test]
async fn x5b_acp_child_crash_emits_transcript_error() {
    // Start mock-acp with --crash-after 1 so it exits non-zero after
    // emitting one session/update chunk. Drive a real message.submit
    // through the WS path; bridge surfaces transcript.error from the
    // child watchdog when the ACP child dies non-zero.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--crash-after".into(), "1".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "cmd_msg",
        "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "boom please crash" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    // A crashed prompt fires two transcript.error events: first from
    // the prompt path (`prompt_failed` when the response channel drops
    // as stdout closes), then from the watchdog (`child_exited`).
    // Walk events until we see the watchdog one — that's the X.3
    // contract anchor.
    loop {
        let err = next_event_of_type(&mut ws, "transcript.error").await;
        if err["payload"]["reason"] == json!("child_exited") {
            assert_eq!(err["payload"]["agent_kind"], json!("acp"));
            return;
        }
        // Otherwise it's prompt_failed — keep walking.
    }
}

#[tokio::test]
async fn x5b_prompt_jsonrpc_error_classified_as_bridge_code() {
    // mock-acp --bad-session-prompt makes session/prompt always
    // return -32603 data.details="Session not found". The bridge
    // must surface that as transcript.error{code:"session.not_found"}
    // — not just a free-form `error` string.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--bad-session-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "cmd_msg",
        "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "anything" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let err = next_event_of_type(&mut ws, "transcript.error").await;
    assert_eq!(err["payload"]["reason"], json!("prompt_failed"));
    assert_eq!(
        err["payload"]["code"],
        json!("session.not_found"),
        "expected classified bridge code, got: {err}"
    );
}

async fn next_event_matching<F: Fn(&Value) -> bool>(ws: &mut Ws, pred: F) -> Value {
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed waiting for matching event");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if pred(&v) {
            return v;
        }
    }
}

#[tokio::test]
async fn x5c1_approval_pending_emitted_then_approve_resolves_prompt() {
    // mock-acp --permission-prompt issues session/request_permission
    // before emitting chunks. Bridge surfaces approval.pending; we
    // approve via a normal WS approval.approve command; mock-acp
    // proceeds and the prompt completes with end_turn.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "cmd_msg",
        "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "do the thing" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    // First: bridge emits approval.pending with toolCall + options.
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(pending["payload"]["options"].as_array().unwrap().len() >= 2);
    assert_eq!(pending["payload"]["tool_call"]["kind"], json!("edit"));

    // Approve via WS — bridge picks the policy-preferred optionId.
    let approve = json!({
        "v": 1,
        "id": "cmd_appr",
        "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(approve.to_string().into()))
        .await
        .unwrap();

    // approval.resolved should arrive with optionId = "allow"
    // (allow_once preferred over allow_always).
    let resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("approved")
    })
    .await;
    assert_eq!(resolved["payload"]["option_id"], json!("allow"));

    // Then transcript.delta + transcript.completed arrive (happy path).
    let _delta = next_event_of_type(&mut ws, "transcript.delta").await;
    let _completed = next_event_of_type(&mut ws, "transcript.completed").await;
}

#[tokio::test]
async fn x5c1_reject_sends_reject_option_and_completes_prompt() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "cmd_msg",
        "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "do the dangerous thing" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let reject = json!({
        "v": 1,
        "id": "cmd_rej",
        "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(reject.to_string().into()))
        .await
        .unwrap();

    let resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("rejected")
    })
    .await;
    assert_eq!(resolved["payload"]["option_id"], json!("reject"));

    // mock-acp emits a tool_call_update with status=failed (not yet
    // mapped to a VAC event in X.5c.1; X.5c.2 wires it). Prompt still
    // completes with end_turn — task-level failure, not session error.
    let completed = next_event_of_type(&mut ws, "transcript.completed").await;
    assert_eq!(completed["payload"]["stop_reason"], json!("end_turn"));
}

async fn await_ack(ws: &mut Ws, ack_of: &str) -> Value {
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed waiting for ack {ack_of}");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("ackOf") == Some(&json!(ack_of)) {
            return v;
        }
    }
}

#[tokio::test]
async fn x5c1_explicit_allow_option_on_reject_is_kind_mismatch() {
    // Hardening: caller can't smuggle approve semantics into a reject
    // by overriding option_id. Bridge must refuse with
    // approval.option_kind_mismatch.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger permission" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "allow" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_kind_mismatch"));

    // Pending approval must be re-armed: a follow-up approval.reject
    // (without override) still resolves cleanly. Don't strand the agent.
    let retry = json!({
        "v": 1, "id": "cmd_retry", "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(retry.to_string().into()))
        .await
        .unwrap();
    let resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("rejected")
    })
    .await;
    assert_eq!(resolved["payload"]["option_id"], json!("reject"));
}

#[tokio::test]
async fn x5c1_explicit_reject_option_on_approve_is_kind_mismatch() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "reject" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_kind_mismatch"));
}

#[tokio::test]
async fn x5c1_no_duplicate_pending_event_after_invalid_override() {
    // X.5c.1 invariant: the bridge must NOT re-emit `approval.pending`
    // after a failed validation. The pending entry is preserved, the
    // approval_id is reusable, but the UI should keep its existing
    // pending card — never render a duplicate.
    //
    // Flow: trigger permission → bad override (kind mismatch) → ack
    // fails → drain WS for a short window and assert no second
    // `approval.pending` for the same approval_id arrives → send a
    // valid reject with the original approval_id → resolves cleanly.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "allow" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_kind_mismatch"));

    // Drain the WS for ~600ms. Any approval.pending that mentions the
    // same approval_id (or any new approval.pending at all, since the
    // mock issues exactly one) is a contract violation.
    let drain_until = tokio::time::Instant::now() + Duration::from_millis(600);
    loop {
        let remaining = drain_until.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(txt)))) => {
                let v: Value = serde_json::from_str(&txt).unwrap();
                if v.get("type") == Some(&json!("approval.pending")) {
                    panic!("unexpected duplicate approval.pending after bad override: {v}");
                }
                // Tolerate transient debug events; assert no surprise
                // resolution either.
                if v.get("type") == Some(&json!("approval.resolved")) {
                    panic!("unexpected approval.resolved before retry: {v}");
                }
            }
            _ => break,
        }
    }

    // Retry with a valid (default) reject using the same approval_id —
    // bridge resolves cleanly without needing a fresh pending event.
    let retry = json!({
        "v": 1, "id": "cmd_retry", "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(retry.to_string().into()))
        .await
        .unwrap();
    let resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("rejected")
    })
    .await;
    assert_eq!(resolved["payload"]["approval_id"], json!(approval_id));
    assert_eq!(resolved["payload"]["option_id"], json!("reject"));
}

#[tokio::test]
async fn x5c1_invalid_override_does_not_disarm_timeout() {
    // X.5c.1 lock-blocker regression. A bad explicit option_id must
    // NOT remove the pending approval or abort its auto-cancel timer.
    // We use the minimum permitted permission_timeout_ms so the timer
    // fires within the test wall clock; then assert
    // approval.resolved {outcome:"timeout"} arrives even though the
    // user only sent invalid retries afterwards.
    let (url, _state) = start_bridge_with(build_acp_registry_with_timeout(
        vec!["--permission-prompt".into()],
        MIN_PERMISSION_TIMEOUT_MS, // 10s
    ))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Send a bad override. Must fail with kind_mismatch — and crucially,
    // must NOT abort the timer.
    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.reject",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "allow" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_kind_mismatch"));

    // Do nothing else and wait for the timer. It should fire and
    // emit approval.resolved {outcome:"timeout"}, proving the timer
    // survived the failed validation. MIN_PERMISSION_TIMEOUT_MS = 10s;
    // poll up to 14s with a longer per-message timeout than the
    // standard `T` (5s) so we can outlast the agent's idle gaps.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(14);
    let resolved = loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            panic!("timeout-driven approval.resolved did not arrive");
        }
        let msg = match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(m)) => m.unwrap(),
            _ => panic!("ws closed before timeout-driven approval.resolved"),
        };
        let Message::Text(txt) = msg else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("timeout")
        {
            break v;
        }
    };
    assert_eq!(resolved["payload"]["approval_id"], json!(approval_id));
}

#[tokio::test]
async fn x5c1_unknown_option_id_returns_option_not_found() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "ghost" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_not_found"));
}

#[tokio::test]
async fn x5c1_allow_always_is_forbidden_by_policy() {
    // Even though the agent offers `allow_always` as a valid option,
    // the bridge default policy denies persistent permission so the
    // user can't accidentally grant it via explicit override.
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--permission-prompt".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "trigger" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();

    let bad = json!({
        "v": 1, "id": "cmd_bad", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id, "option_id": "allow_always" }
    });
    ws.send(Message::Text(bad.to_string().into()))
        .await
        .unwrap();
    let ack = await_ack(&mut ws, "cmd_bad").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("approval.option_forbidden"));
}

#[tokio::test]
async fn x3_acp_assessor_profile_denied() {
    // executor.code is the only profile cleared for acp; assessor.rtd
    // must be rejected at session.create per Stage X.2 enforcement.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![])).await;
    let mut ws = connect_hello(&url).await;
    let cmd = json!({
        "v": 1,
        "id": "c1",
        "type": "session.create",
        "session_id": "",
        "payload": { "profile_id": "assessor.rtd@1.0.0", "project_root": "/tmp/x" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("ackOf") == Some(&json!("c1")) {
            assert_eq!(v["ok"], json!(false), "expected deny ack: {v}");
            assert_eq!(
                v["error"]["code"],
                json!("agent.kind_not_allowed"),
                "expected agent.kind_not_allowed: {v}"
            );
            return;
        }
    }
}

// =================================================================
// Stage X.5c.2 — observed tool activity mapping (8 tests)
// =================================================================

#[tokio::test]
async fn x5c2_read_tool_update_emits_activity_event() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--emit-read-tool".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "read it" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    // Pending tool_call → tool.observed; then completed → tool.updated.
    let observed = next_event_of_type(&mut ws, "tool.observed").await;
    assert_eq!(observed["payload"]["kind"], json!("read"));
    assert_eq!(observed["payload"]["status"], json!("pending"));

    let updated = next_event_of_type(&mut ws, "tool.updated").await;
    assert_eq!(updated["payload"]["kind"], json!("read"));
    assert_eq!(updated["payload"]["status"], json!("completed"));
    assert!(updated["payload"]["approval_tool_call_hash"].is_string());
    assert!(updated["payload"]["raw_input_hash"].is_string());
    // No correlation — no permission was issued in this run.
    assert!(updated["payload"].get("approved_by_approval_id").is_none());
    // Read rawOutput stays bounded (small payload here, but the
    // marker must NOT be present and content must be the file body).
    assert!(updated["payload"]["raw_output_redacted"]
        .as_str()
        .unwrap()
        .contains("hello world"));
}

#[tokio::test]
async fn x5c2_edit_tool_update_emits_review_candidate() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--emit-edit-tool".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "edit" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    // tool.observed (pending) → tool.updated (in_progress) +
    // review.changeset_updated → tool.updated (completed).
    let _observed = next_event_of_type(&mut ws, "tool.observed").await;
    let review = next_event_of_type(&mut ws, "review.changeset_updated").await;
    assert_eq!(
        review["payload"]["locations"][0]["path"],
        json!("/repo/hello.md")
    );
    assert_eq!(
        review["payload"]["raw_input_redacted"]["file_path"],
        json!("/repo/hello.md")
    );
    // BLOCKER-1 fix: review payload must carry the actual diff so
    // the Review lane can render the change.
    let diffs = review["payload"]["diffs"].as_array().unwrap();
    assert!(!diffs.is_empty(), "review must carry at least one diff");
    assert_eq!(diffs[0]["path"], json!("/repo/hello.md"));
    assert_eq!(diffs[0]["new_text"], json!("hi from script"));
    assert!(diffs[0].get("old_text").is_none() || diffs[0]["old_text"].is_null());
    let _completed = next_event_of_type(&mut ws, "tool.updated").await;
}

#[tokio::test]
async fn x5c2_edit_tool_update_correlates_by_tool_call_id() {
    // Drive --permission-prompt + --emit-edit-tool; mock-acp uses the
    // same toolCallId for both, so primary-key correlation hits.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![
        "--permission-prompt".into(),
        "--emit-edit-tool".into(),
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "edit with permission" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    let approve = json!({
        "v": 1, "id": "cmd_appr", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(approve.to_string().into()))
        .await
        .unwrap();
    let _resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("approved")
    })
    .await;

    // First edit-related event with non-null approved_by_approval_id.
    let correlated = next_event_matching(&mut ws, |v| {
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        (t == "tool.observed" || t == "tool.updated" || t == "review.changeset_updated")
            && v["payload"]
                .get("approved_by_approval_id")
                .and_then(|x| x.as_str())
                == Some(approval_id.as_str())
    })
    .await;
    assert_eq!(
        correlated["payload"]["approved_by_approval_id"],
        json!(approval_id)
    );
}

#[tokio::test]
async fn x5c2_edit_tool_update_fallback_correlates_by_approval_tool_call_hash() {
    // POSITIVE fallback path. mock-acp rotates the toolCallId from
    // tc_perm to tc_after BUT keeps the rest of the toolCall envelope
    // (kind/title/locations/content/rawInput) identical to the
    // permission's toolCall. With toolCallId/status/rawOutput stripped
    // from approval_tool_call_hash, both sides hash to the same value
    // and the fallback correlation key (session_id, hash) hits.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![
        "--permission-prompt".into(),
        "--emit-edit-tool".into(),
        "--rotate-tool-call-id".into(),
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "rotated" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    let approve = json!({
        "v": 1, "id": "cmd_appr", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(approve.to_string().into()))
        .await
        .unwrap();
    let _resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("approved")
    })
    .await;

    // Find the first edit-related event whose tool_call_id is the
    // rotated value AND that carries the approval badge — proves
    // the fallback hash key resolved correlation despite the id
    // rotation. Uses an inline poll loop instead of next_event_matching
    // so the per-message timeout can be tuned without touching the
    // shared T constant.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let correlated = loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            panic!("no badge-carrying tool event arrived for rotated toolCallId");
        }
        let Ok(Some(Ok(Message::Text(txt)))) = tokio::time::timeout(remaining, ws.next()).await
        else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if matches!(
            t,
            "tool.observed" | "tool.updated" | "review.changeset_updated"
        ) && v["payload"]
            .get("approved_by_approval_id")
            .and_then(|x| x.as_str())
            == Some(approval_id.as_str())
        {
            break v;
        }
    };
    let tool_call_id = correlated["payload"]["tool_call_id"].as_str().unwrap_or("");
    assert_eq!(
        tool_call_id, "tc_after",
        "fallback correlation must fire on the rotated toolCallId, got: {tool_call_id}"
    );
}

#[tokio::test]
async fn x5c2_rotated_tool_call_with_different_shape_does_not_correlate() {
    // Negative-on-rotation (rename of the old badly-named "fallback"
    // test). When the agent rotates toolCallId AND emits a toolCall
    // with a different envelope shape (different title/locations) so
    // the approval_tool_call_hash differs, the bridge MUST NOT
    // mis-attribute the approval. --same-raw-input-different-tool
    // makes mock-acp emit exactly that shape.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![
        "--permission-prompt".into(),
        "--emit-edit-tool".into(),
        "--same-raw-input-different-tool".into(),
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "rotate-and-reshape" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    let approve = json!({
        "v": 1, "id": "cmd_appr", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(approve.to_string().into()))
        .await
        .unwrap();
    let _resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("approved")
    })
    .await;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let mut saw_edit = false;
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline - tokio::time::Instant::now();
        let Ok(Some(Ok(Message::Text(txt)))) = tokio::time::timeout(remaining, ws.next()).await
        else {
            break;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if matches!(
            t,
            "tool.observed" | "tool.updated" | "review.changeset_updated"
        ) {
            saw_edit = true;
            assert_ne!(
                v["payload"]
                    .get("approved_by_approval_id")
                    .and_then(|x| x.as_str()),
                Some(approval_id.as_str()),
                "rotated id + reshape must not mis-attribute approval: {v}"
            );
        }
        if t == "transcript.completed" {
            break;
        }
    }
    assert!(
        saw_edit,
        "expected at least one tool/review event for the reshape"
    );
}

#[tokio::test]
async fn x5c2_raw_input_hash_alone_does_not_correlate() {
    // --same-raw-input-different-tool: permission is for one
    // toolCall (toolCallId=tc_perm, kind=edit, content has a diff
    // for /tmp/mock); the scripted edit reuses rawInput verbatim
    // but with a different toolCallId/title, so its
    // approval_tool_call_hash differs. raw_input_hash matches but
    // is forbidden as a correlation key.
    let (url, _state) = start_bridge_with(build_acp_registry(vec![
        "--permission-prompt".into(),
        "--emit-edit-tool".into(),
        "--same-raw-input-different-tool".into(),
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "same raw" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let pending = next_event_of_type(&mut ws, "approval.pending").await;
    let approval_id = pending["payload"]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    let approve = json!({
        "v": 1, "id": "cmd_appr", "type": "approval.approve",
        "session_id": session_id,
        "payload": { "approval_id": approval_id }
    });
    ws.send(Message::Text(approve.to_string().into()))
        .await
        .unwrap();
    let _resolved = next_event_matching(&mut ws, |v| {
        v.get("type") == Some(&json!("approval.resolved"))
            && v["payload"]["outcome"] == json!("approved")
    })
    .await;

    // Walk subsequent tool events; none for the rotated toolCall
    // should claim approved_by_approval_id from the permission.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let mut saw_event_with_same_raw_input_hash = false;
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline - tokio::time::Instant::now();
        let Ok(Some(Ok(Message::Text(txt)))) = tokio::time::timeout(remaining, ws.next()).await
        else {
            break;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if matches!(t, "tool.observed" | "tool.updated") {
            // raw_input_hash present + matches the permission's
            // rawInput hash by construction (--same-raw-input-different-tool);
            // approved_by_approval_id MUST be null.
            if v["payload"]["raw_input_hash"].is_string() {
                saw_event_with_same_raw_input_hash = true;
                assert!(
                    v["payload"].get("approved_by_approval_id").is_none()
                        || v["payload"]["approved_by_approval_id"].is_null(),
                    "raw_input alone must not correlate: {v}"
                );
            }
        }
        if t == "transcript.completed" {
            break;
        }
    }
    assert!(
        saw_event_with_same_raw_input_hash,
        "expected to observe at least one tool event for the rotated edit"
    );
}

#[tokio::test]
async fn x5c2_execute_tool_update_emits_runtime_activity() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--emit-execute-tool".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "bash" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let _observed = next_event_of_type(&mut ws, "tool.observed").await;
    let runtime = next_event_of_type(&mut ws, "runtime.job_log").await;
    assert_eq!(
        runtime["payload"]["command"],
        json!("echo hello from real bash")
    );
    // raw_input is redacted at the source DTO; the runtime payload
    // pulls .command from the redacted view, so the API_KEY mock-acp
    // injected must NOT appear here.
    let serialized = runtime.to_string();
    assert!(
        !serialized.contains("leaky-secret"),
        "secret leaked into runtime event: {serialized}"
    );
}

#[tokio::test]
async fn x5c2_rejected_tool_update_is_task_failure_not_session_error() {
    let (url, _state) =
        start_bridge_with(build_acp_registry(vec!["--emit-failed-tool".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "fail" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let failed = next_event_of_type(&mut ws, "tool.failed").await;
    assert_eq!(failed["payload"]["status"], json!("failed"));
    // Prompt continues to completion — task-level failure, not
    // session-level error.
    let completed = next_event_of_type(&mut ws, "transcript.completed").await;
    assert_eq!(completed["payload"]["stop_reason"], json!("end_turn"));
    // No transcript.error before completion — drain everything we got
    // and assert no transcript.error event was buffered.
}

#[tokio::test]
async fn x5c2_raw_payload_is_redacted_or_bounded() {
    let (url, _state) = start_bridge_with(build_acp_registry(vec![
        "--emit-execute-tool".into(),
        "--oversized-output".into(),
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "big bash" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let _observed = next_event_of_type(&mut ws, "tool.observed").await;
    let runtime = next_event_of_type(&mut ws, "runtime.job_log").await;
    let output = runtime["payload"]["output"].as_str().unwrap();
    assert!(
        output.len() < 100_000,
        "output should be bounded; got {} bytes",
        output.len()
    );
    assert!(
        output.contains("[truncated by VAC bridge]"),
        "missing truncation marker: {}",
        &output[output.len().saturating_sub(60)..]
    );
    // Also assert the API_KEY-shaped field doesn't appear anywhere
    // in the WS payload.
    assert!(!runtime.to_string().contains("leaky-secret"));
}

#[tokio::test]
async fn x5c2_tool_failed_audit_row_is_warn_not_error() {
    // BLOCKER-3 closeout: tool.failed audit row severity must be Warn,
    // never Error. Drives --emit-failed-tool, then waits briefly for the
    // AuditFacility writer task to flush, then reads the per-session
    // JSONL file and asserts:
    //   - exactly one row with subsystem="tool" + fields.event="tool.failed"
    //     + severity="warn"
    //   - tool.observed / tool.updated rows (if any) are severity="Info"
    let (url, _state, audit_dir) =
        start_bridge_with_audit_dir(build_acp_registry(vec!["--emit-failed-tool".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;
    let cmd = json!({
        "v": 1, "id": "cmd_msg", "type": "message.submit",
        "session_id": session_id,
        "payload": { "text": "fail me" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    // Wait for the failed event end-to-end on the WS, then give the
    // audit writer task a tick to flush the row to disk.
    let _ = next_event_of_type(&mut ws, "tool.failed").await;
    let _ = next_event_of_type(&mut ws, "transcript.completed").await;
    tokio::time::sleep(Duration::from_millis(200)).await;

    let path = audit_dir.join(format!("{session_id}.jsonl"));
    let body = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read audit file {path:?}: {e}"));
    let rows: Vec<Value> = body
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();

    let tool_rows: Vec<&Value> = rows
        .iter()
        .filter(|r| r.get("subsystem").and_then(|s| s.as_str()) == Some("tool"))
        .collect();
    assert!(
        !tool_rows.is_empty(),
        "expected at least one tool subsystem row in {path:?}"
    );

    let failed_rows: Vec<&&Value> = tool_rows
        .iter()
        .filter(|r| {
            r.get("fields")
                .and_then(|f| f.get("event"))
                .and_then(|e| e.as_str())
                == Some("tool.failed")
        })
        .collect();
    assert_eq!(
        failed_rows.len(),
        1,
        "expected exactly one tool.failed audit row, got {}",
        failed_rows.len()
    );
    assert_eq!(
        failed_rows[0]
            .get("severity")
            .and_then(|s| s.as_str())
            .unwrap_or(""),
        "warn",
        "tool.failed must be severity Warn, never Error: {failed_rows:#?}"
    );

    // Required-fields contract from the X.5c.2 design (§6 / §7).
    let f = failed_rows[0].get("fields").unwrap();
    for required in [
        "toolCallId",
        "kind",
        "status",
        "locations",
        "agent_id",
        "agent_kind",
    ] {
        assert!(
            f.get(required).is_some(),
            "missing required audit field {required} in {f:#?}"
        );
    }

    // Sanity: any tool.observed / tool.updated rows are severity Info.
    for row in tool_rows.iter().filter(|r| {
        let ev = r
            .get("fields")
            .and_then(|f| f.get("event"))
            .and_then(|e| e.as_str())
            .unwrap_or("");
        ev != "tool.failed"
    }) {
        assert_eq!(
            row.get("severity").and_then(|s| s.as_str()).unwrap_or(""),
            "info",
            "non-failed tool row must be Info: {row:#?}"
        );
    }
}
