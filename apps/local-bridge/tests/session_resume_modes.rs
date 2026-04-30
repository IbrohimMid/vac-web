//! Stage X6 batch 4-3 — resume_mode dispatch matrix (no-persistence cells).
//!
//! These tests exercise the branches of the dispatch matrix in
//! `translator/mod.rs::session.resume` that don't require a configured
//! persistence backend. The full meta + caps grid (caps=true native
//! handoff, caps=false fallback to replay) is covered in batch 4-6
//! once a real `FileSessionPersistence` is wired into the test harness.
//!
//! Matrix cells covered here:
//!   - `resume_mode = "bogus"`               → reason `unknown_resume_mode`
//!   - `acp_load` with no `vac_session_id`   → reason `vac_session_unknown`
//!   - `native_or_replay` no `vac_session_id`→ reason `vac_session_unknown`
//!   - `acp_load` + vac_session_id, no persistence → ack `persistence.disabled`
//!   - `replay_only` (P2-C regression)       → must NOT be rejected by the matrix

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

async fn start_bridge() -> String {
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
    std::mem::forget(tmp);
    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("ws://{}/api/sessions/stream", addr)
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

/// Drive a `session.resume` and collect the failed event + ack.
async fn drive_resume(payload: Value) -> (Option<Value>, Value) {
    let url = start_bridge().await;
    let mut ws = connect_hello(&url).await;
    send(
        &mut ws,
        json!({
            "id": "cmd_resume",
            "session_id": "sess_unknown",
            "type": "session.resume",
            "payload": payload,
            "v": 1,
        }),
    )
    .await;

    // Drain until we see both an ack and (optionally) a failed event.
    // The bridge may emit the ack and the failed event in either
    // order, so don't bail on the first ack — keep reading with a
    // short timeout once the ack lands to give the event a chance.
    let mut failed_event: Option<Value> = None;
    let mut ack: Option<Value> = None;
    for _ in 0..30 {
        let next = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
        let Ok(Some(Ok(msg))) = next else {
            break;
        };
        let v: Value = match msg {
            Message::Text(t) => match serde_json::from_str(&t) {
                Ok(v) => v,
                Err(_) => continue,
            },
            _ => continue,
        };
        if v.get("ackOf") == Some(&json!("cmd_resume")) {
            ack = Some(v);
        } else if v.get("type") == Some(&json!("session.resume.failed")) {
            failed_event = Some(v);
        }
        if ack.is_some() && failed_event.is_some() {
            break;
        }
    }
    (failed_event, ack.expect("never saw ack for session.resume"))
}

#[tokio::test]
async fn x6_b43_unknown_resume_mode_rejected() {
    // Anything that isn't `replay_only`, `acp_load`, or `native_or_replay`
    // must surface a typed `unknown_resume_mode` failure so a typo on
    // the FE side never silently downgrades.
    let (event, ack) = drive_resume(json!({
        "vac_session_id": "sess_alpha",
        "resume_mode": "native",
    }))
    .await;
    let event = event.expect("missing session.resume.failed event");

    assert_eq!(event["payload"]["reason"], "unknown_resume_mode");
    assert_eq!(event["payload"]["requested_mode"], "native");
    assert_eq!(event["payload"]["mode"], "native");
    assert_eq!(event["payload"]["vac_session_id"], "sess_alpha");
    assert_eq!(event["v"], 1);

    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "session.unknown_resume_mode");
}

#[tokio::test]
async fn x6_b43_acp_load_without_vac_session_id_rejected() {
    // `acp_load` requires a vac_session_id. Without one, the bridge
    // returns a typed `vac_session_unknown` failure instead of
    // probing persistence.
    let (event, ack) = drive_resume(json!({
        "resume_mode": "acp_load",
    }))
    .await;
    let event = event.expect("missing session.resume.failed event");

    assert_eq!(event["payload"]["reason"], "vac_session_unknown");
    assert_eq!(event["payload"]["mode"], "acp_load");
    assert_eq!(event["payload"]["vac_session_id"], Value::Null);

    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "session.vac_session_unknown");
}

#[tokio::test]
async fn x6_b43_native_or_replay_without_vac_session_id_rejected() {
    let (event, ack) = drive_resume(json!({
        "resume_mode": "native_or_replay",
    }))
    .await;
    let event = event.expect("missing session.resume.failed event");

    assert_eq!(event["payload"]["reason"], "vac_session_unknown");
    assert_eq!(event["payload"]["mode"], "native_or_replay");

    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "session.vac_session_unknown");
}

#[tokio::test]
async fn x6_b43_acp_load_without_persistence_disabled() {
    // `acp_load` + vac_session_id but no persistence backend: the
    // bridge surfaces `persistence.disabled` (no failed event), since
    // we never got far enough to read meta.
    let (event, ack) = drive_resume(json!({
        "vac_session_id": "sess_alpha",
        "resume_mode": "acp_load",
    }))
    .await;

    assert!(
        event.is_none(),
        "persistence.disabled path must NOT emit session.resume.failed"
    );
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "persistence.disabled");
}

#[tokio::test]
async fn x6_b43_native_or_replay_without_persistence_disabled() {
    let (event, ack) = drive_resume(json!({
        "vac_session_id": "sess_alpha",
        "resume_mode": "native_or_replay",
    }))
    .await;

    assert!(event.is_none());
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "persistence.disabled");
}

#[tokio::test]
async fn x6_b43_replay_only_still_works_after_matrix() {
    // Regression: the explicit `replay_only` value must NOT be rejected
    // by the new dispatch matrix. Without a persistence backend it
    // surfaces `persistence.disabled` like the other modes — never the
    // matrix-level `unknown_resume_mode`.
    let (event, ack) = drive_resume(json!({
        "vac_session_id": "sess_alpha",
        "resume_mode": "replay_only",
    }))
    .await;

    assert!(
        event.is_none(),
        "replay_only with no persistence must not emit session.resume.failed"
    );
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "persistence.disabled");
}
