//! Session lifecycle tests: creation, explicit close, reaper cleanup after child exit,
//! broadcast streaming, and unknown-command rejection.

#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
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
    for _ in 0..15 {
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
