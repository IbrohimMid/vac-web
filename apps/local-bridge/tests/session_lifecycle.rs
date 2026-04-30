//! Session lifecycle tests: creation, explicit close, reaper cleanup after child exit,
//! broadcast streaming, and unknown-command rejection.

#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::handoff::HandoffService;
use local_bridge::server::{build_app, AppState};
use local_bridge::session::persistence::PersistenceHealth;
use local_bridge::session::SessionRegistry;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

const T: Duration = Duration::from_secs(5);

fn mock_engine_bin() -> PathBuf {
    let m = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = m.parent().unwrap().parent().unwrap();
    for p in [
        root.join("target/debug/mock-engine"),
        root.join("target/release/mock-engine"),
    ] {
        if p.exists() {
            return p;
        }
    }
    panic!("mock-engine not built")
}

async fn start_bridge() -> (String, Arc<AppState>) {
    let tmp = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions: SessionRegistry::new(mock_engine_bin()),
        auth: AuthState::new_dev(),
        audit: Arc::new(AuditFacility::new(tmp.path().to_path_buf())),
        pairing: PairingStore::new(),
        profile_root: PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/protocol/v1/profiles"
        )),
        handoff: Arc::new(HandoffService::new()),
        persistence: None,
        persistence_health: PersistenceHealth::default(),
        assessment_index: None,
        resume_policy: std::sync::Arc::new(local_bridge::config::SessionResumePolicy::default()),
        config_snapshot: std::sync::Arc::new(tokio::sync::RwLock::new(
            local_bridge::config::ConfigSnapshot::default(),
        )),
    });
    std::mem::forget(tmp); // keep audit dir alive for test duration
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
    let _ = recv(&mut ws).await; // welcome
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

async fn recv(ws: &mut Ws) -> Value {
    let msg = tokio::time::timeout(T, ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    match msg {
        Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("unexpected {other:?}"),
    }
}

async fn drain_pending(ws: &mut Ws) {
    while let Ok(Some(Ok(_))) = tokio::time::timeout(Duration::from_millis(100), ws.next()).await {
        // Discard whatever was buffered so the next assertion starts
        // from a quiet WS.
    }
}

/// Create a session via WS and return its id.
async fn create_session(ws: &mut Ws, profile: &str) -> String {
    send(
        ws,
        json!({
            "id": "cmd_create",
            "session_id": "sess_pre",
            "type": "session.create",
            "payload": { "profile_id": profile, "project_root": "/tmp/p" },
            "v": 1
        }),
    )
    .await;
    for _ in 0..5 {
        let v = recv(ws).await;
        if v["type"] == "session.ready" {
            return v["session_id"].as_str().unwrap().to_string();
        }
    }
    panic!("never saw session.ready");
}

/// Create a session with an explicit workflow_id and return (session_id, session.ready payload).
async fn create_session_with_workflow(
    ws: &mut Ws,
    profile: &str,
    workflow_id: &str,
) -> (String, serde_json::Value) {
    send(
        ws,
        json!({
            "id": "cmd_create_wf",
            "session_id": "sess_pre",
            "type": "session.create",
            "payload": { "profile_id": profile, "project_root": "/tmp/p", "workflow_id": workflow_id },
            "v": 1
        }),
    )
    .await;
    for _ in 0..10 {
        let v = recv(ws).await;
        if v["type"] == "session.ready" {
            let sid = v["session_id"].as_str().unwrap().to_string();
            return (sid, v);
        }
    }
    panic!("never saw session.ready");
}

#[tokio::test]
async fn explicit_session_close_removes_from_registry() {
    let (url, state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "assessor.rtd@1.0.0").await;
    assert_eq!(state.sessions.count(), 1);

    send(
        &mut ws,
        json!({
            "id": "cmd_close",
            "session_id": sid.clone(),
            "type": "session.close",
            "payload": {},
            "v": 1
        }),
    )
    .await;

    // Drain until we see the ack.
    for _ in 0..10 {
        let v = recv(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_close")) {
            assert_eq!(v["ok"], true);
            break;
        }
    }
    assert_eq!(
        state.sessions.count(),
        0,
        "session must be removed from registry after explicit close"
    );
}

#[tokio::test]
async fn unknown_command_rejected_at_bridge() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    // Create session so session_id resolves.
    let sid = create_session(&mut ws, "assessor.rtd@1.0.0").await;
    send(
        &mut ws,
        json!({
            "id": "cmd_bad",
            "session_id": sid,
            "type": "definitely.not.in.catalog",
            "payload": {},
            "v": 1
        }),
    )
    .await;
    for _ in 0..10 {
        let v = recv(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_bad")) {
            assert_eq!(v["ok"], false);
            assert_eq!(v["error"]["code"], "protocol.unknown_command");
            return;
        }
    }
    panic!("never saw ack");
}

#[tokio::test]
async fn session_create_with_missing_profile_rejected() {
    let (url, state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    send(
        &mut ws,
        json!({
            "id": "cmd_create_bad",
            "session_id": "sess_pre",
            "type": "session.create",
            "payload": { "profile_id": "ghost.profile@9.9.9", "project_root": "/tmp/p" },
            "v": 1
        }),
    )
    .await;
    for _ in 0..5 {
        let v = recv(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_create_bad")) {
            assert_eq!(v["ok"], false);
            assert_eq!(v["error"]["code"], "profile.not_found");
            assert_eq!(state.sessions.count(), 0);
            return;
        }
    }
    panic!("no ack");
}

#[tokio::test]
async fn default_workflow_is_observe_tools() {
    // Verify that a session created without workflow_id uses build.observe-tools.
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    send(
        &mut ws,
        json!({
            "id": "cmd_create_def",
            "session_id": "sess_pre",
            "type": "session.create",
            "payload": { "profile_id": "assessor.rtd@1.0.0", "project_root": "/tmp/p" },
            "v": 1
        }),
    )
    .await;
    for _ in 0..10 {
        let v = recv(&mut ws).await;
        if v["type"] == "session.ready" {
            assert_eq!(
                v["payload"]["workflow_id"], "build.observe-tools",
                "default workflow must be build.observe-tools"
            );
            return;
        }
    }
    panic!("never saw session.ready");
}

#[tokio::test]
async fn session_create_with_valid_workflow_id_in_session_ready() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    let (_sid, ready_payload) =
        create_session_with_workflow(&mut ws, "assessor.rtd@1.0.0", "build.basic").await;
    assert_eq!(
        ready_payload["payload"]["workflow_id"], "build.basic",
        "session.ready must echo the requested workflow_id"
    );
    assert_eq!(
        ready_payload["payload"]["workflow_name"], "Basic Build Workflow",
        "session.ready must include the workflow display name"
    );
}

#[tokio::test]
async fn session_resume_replays_history_and_switches_session() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;
    drain_pending(&mut ws).await;

    send(
        &mut ws,
        json!({
            "id": "cmd_resume",
            "session_id": sid.clone(),
            "type": "session.resume",
            "payload": {},
            "v": 1
        }),
    )
    .await;

    let mut saw_ack = false;
    let mut saw_ready = false;
    let mut saw_capabilities = false;
    for _ in 0..20 {
        let v = recv(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_resume")) {
            assert_eq!(v["ok"], true);
            saw_ack = true;
            continue;
        }
        if v["type"] == "session.ready" && v["session_id"] == sid {
            saw_ready = true;
            continue;
        }
        if v["type"] == "system.capabilities" {
            saw_capabilities = true;
        }
        if saw_ack && saw_ready && saw_capabilities {
            break;
        }
    }

    assert!(saw_ack, "resume must ack ok=true");
    assert!(
        saw_ready,
        "resume must emit session.ready for the target session"
    );
    assert!(
        saw_capabilities,
        "resume should replay prior session history, not just ack"
    );
}

#[tokio::test]
async fn path_like_workflow_id_rejected() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    for wid in [
        "../../x.yaml",
        "/tmp/x.yaml",
        "file:///etc/passwd",
        "http://example.com/evil.yaml",
    ] {
        send(
            &mut ws,
            json!({
                "id": format!("cmd_{}", wid.len()),
                "session_id": "sess_pre",
                "type": "session.create",
                "payload": {
                    "profile_id": "assessor.rtd@1.0.0",
                    "project_root": "/tmp/p",
                    "workflow_id": wid
                },
                "v": 1
            }),
        )
        .await;
        let mut saw_ack_false = false;
        for _ in 0..10 {
            let v = recv(&mut ws).await;
            if v.get("ackOf") == Some(&json!(format!("cmd_{}", wid.len()))) {
                assert_eq!(
                    v["ok"], false,
                    "path-like workflow_id '{wid}' must be rejected"
                );
                assert_eq!(v["error"]["code"], "workflow.not_found");
                saw_ack_false = true;
                break;
            }
        }
        assert!(saw_ack_false, "never saw ack false for '{wid}'");
    }
}

#[tokio::test]
async fn session_create_with_invalid_workflow_id_acks_false() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    send(
        &mut ws,
        json!({
            "id": "cmd_create_bad_wf",
            "session_id": "sess_pre",
            "type": "session.create",
            "payload": {
                "profile_id": "assessor.rtd@1.0.0",
                "project_root": "/tmp/p",
                "workflow_id": "nonexistent.workflow.xyz"
            },
            "v": 1
        }),
    )
    .await;
    // Expect ack with ok: false and code workflow.not_found.
    // No session.ready should appear.
    let mut saw_ack_false = false;
    let mut saw_session_ready = false;
    for _ in 0..15 {
        let v = recv(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_create_bad_wf")) {
            assert_eq!(v["ok"], false, "ack must be false for unknown workflow_id");
            assert_eq!(
                v["error"]["code"], "workflow.not_found",
                "error code must be workflow.not_found"
            );
            saw_ack_false = true;
        }
        if v["type"] == "session.ready" {
            saw_session_ready = true;
        }
        if saw_ack_false {
            break;
        }
    }
    assert!(
        saw_ack_false,
        "must receive ack false for unknown workflow_id"
    );
    assert!(
        !saw_session_ready,
        "session must NOT be created for unknown workflow_id"
    );
}

#[tokio::test]
async fn broadcast_delivers_engine_events_to_client() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;
    send(
        &mut ws,
        json!({
            "id": "cmd_msg",
            "session_id": sid,
            "type": "message.submit",
            "payload": { "text": "hi" },
            "v": 1
        }),
    )
    .await;

    let mut saw_delta = false;
    let mut saw_completed = false;
    for _ in 0..30 {
        let v = recv(&mut ws).await;
        match v["type"].as_str() {
            Some("transcript.delta") => saw_delta = true,
            Some("transcript.completed") => saw_completed = true,
            _ => {}
        }
        if saw_delta && saw_completed {
            break;
        }
    }
    assert!(saw_delta, "no transcript.delta reached client");
    assert!(saw_completed, "no transcript.completed reached client");
}
