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

async fn start_bridge_with(registry: AgentRuntimeRegistry) -> (String, Arc<AppState>) {
    let tmp = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions: SessionRegistry::with_runtime(Arc::new(registry)),
        auth: AuthState::new_dev(),
        audit: AuditFacility::new(tmp.path().to_path_buf()),
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
