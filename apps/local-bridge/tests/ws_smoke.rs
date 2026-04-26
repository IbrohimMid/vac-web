//! Phase 1.1+1.2+1.3+1.4 smoke: spawn bridge, connect WS, exchange envelopes,
//! verify session.create + message.submit + streaming + auth + ring replay.

// Axum 0.7 Message::Text <-> Utf8Bytes conversion.
#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::handoff::HandoffService;
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
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().unwrap().parent().unwrap();
    let candidates = [
        root.join("target/debug/mock-engine"),
        root.join("target/release/mock-engine"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    panic!("mock-engine binary not built; run `cargo build -p mock-engine`")
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
    });
    // Leak the tempdir so the audit dir survives the test run.
    std::mem::forget(tmp);

    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("ws://{}/api/sessions/stream", addr), state)
}

async fn connect(
    url: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (s, _r) = tokio_tungstenite::connect_async(url).await.unwrap();
    s
}

async fn send_text<S>(ws: &mut S, v: Value)
where
    S: SinkExt<Message> + Unpin,
    <S as futures::Sink<Message>>::Error: std::fmt::Debug,
{
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

async fn recv_text<S>(ws: &mut S) -> Value
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let msg = tokio::time::timeout(T, ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    match msg {
        Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("expected text frame, got {other:?}"),
    }
}

#[tokio::test]
async fn handshake_welcome() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect(&url).await;
    send_text(&mut ws, json!({ "type": "hello", "protocol_version": 1 })).await;
    let welcome = recv_text(&mut ws).await;
    assert_eq!(welcome["type"], "welcome");
    assert_eq!(welcome["protocol_version"], 1);
}

#[tokio::test]
async fn bad_first_frame_rejected() {
    let (url, _) = start_bridge().await;
    let mut ws = connect(&url).await;
    send_text(&mut ws, json!({ "type": "wrong_first_frame" })).await;
    let resp = recv_text(&mut ws).await;
    assert_eq!(resp["ok"], false);
    assert!(resp["error"]["code"].is_string());
}

#[tokio::test]
async fn session_create_and_message_submit() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect(&url).await;
    send_text(&mut ws, json!({ "type": "hello", "protocol_version": 1 })).await;
    let _welcome = recv_text(&mut ws).await;

    // Create session via command envelope.
    send_text(
        &mut ws,
        json!({
            "id": "cmd_01J00000000000000000000001",
            "session_id": "sess_placeholder_not_used_for_create",
            "type": "session.create",
            "payload": { "profile_id": "executor.code@1.0.0", "project_root": "/tmp/project" },
            "v": 1
        }),
    )
    .await;

    // Expect ack (ok=true) + session.ready event, in some order.
    let mut got_ack = false;
    let mut session_id = String::new();
    for _ in 0..4 {
        let v = recv_text(&mut ws).await;
        if v.get("ackOf").is_some() {
            assert_eq!(v["ok"], true);
            got_ack = true;
        } else if v["type"] == "session.ready" {
            session_id = v["session_id"].as_str().unwrap().to_string();
        } else {
            // stream of other events OK
        }
        if got_ack && !session_id.is_empty() {
            break;
        }
    }
    assert!(got_ack);
    assert!(session_id.starts_with("sess_"));

    // Submit message; expect engine-side streaming via broadcast.
    send_text(
        &mut ws,
        json!({
            "id": "cmd_01J00000000000000000000002",
            "session_id": session_id,
            "type": "message.submit",
            "payload": { "text": "hello" },
            "v": 1
        }),
    )
    .await;

    // Collect ack (may arrive after engine-broadcast events now that subscription is wired).
    let mut ack_ok = false;
    for _ in 0..10 {
        let v = recv_text(&mut ws).await;
        if v.get("ackOf") == Some(&json!("cmd_01J00000000000000000000002")) {
            ack_ok = v["ok"] == true;
            break;
        }
        // Otherwise it's a streaming transcript event from engine; continue.
    }
    assert!(ack_ok, "expected ack for message.submit");
}

#[tokio::test]
async fn auth_endpoints_roundtrip() {
    let (url, state) = start_bridge().await;
    // Use HTTP directly.
    let http_url = url
        .replace("ws://", "http://")
        .replace("/api/sessions/stream", "");
    let client = reqwest::Client::new();

    let mint: Value = client
        .post(format!("{http_url}/api/pair/mint"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let code = mint["code"].as_str().unwrap().to_string();

    let exchange: Value = client
        .post(format!("{http_url}/api/pair/exchange"))
        .json(&json!({
            "code": code,
            "device_id": "dev_test",
            "project_root": "/tmp/p"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(exchange["access_token"].is_string());

    // Verify JWT via state.auth
    let token = exchange["access_token"].as_str().unwrap();
    let claims = state.auth.verify(token).unwrap();
    assert_eq!(claims.device_id, "dev_test");
}

#[tokio::test]
async fn reused_pair_code_rejected() {
    let (url, _) = start_bridge().await;
    let http_url = url
        .replace("ws://", "http://")
        .replace("/api/sessions/stream", "");
    let client = reqwest::Client::new();
    let mint: Value = client
        .post(format!("{http_url}/api/pair/mint"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let code = mint["code"].as_str().unwrap().to_string();
    let req = |code: String| {
        let c = client.clone();
        let http_url = http_url.clone();
        async move {
            c.post(format!("{http_url}/api/pair/exchange"))
                .json(&json!({"code": code, "device_id": "d", "project_root": "/p"}))
                .send()
                .await
                .unwrap()
                .status()
                .as_u16()
        }
    };
    assert_eq!(req(code.clone()).await, 200);
    assert_eq!(req(code).await, 401);
}
