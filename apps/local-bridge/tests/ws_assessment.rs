//! Phase P1: WS contract tests for assessment.* commands.
//!
//! These tests assert the dispatch envelope contract for assessment
//! commands without requiring a fully seeded persistence backend:
//!
//!   - query commands return `persistence.disabled` when persistence is
//!     not configured (default in this test harness)
//!   - commands with required payload fields return
//!     `assessment.invalid_payload` when those fields are absent
//!   - `assessment.sweep.cancel` returns `assessment.not_found` when the
//!     sweep id is unknown
//!   - `assessment.run` returns `session.not_found` when the WS command
//!     references an unknown session
//!
//! Positive-path tests (driving sweep.run, list_runs against a session
//! with seeded events) require the FilePersistence harness and live in a
//! follow-up file (`ws_assessment_persistence.rs`).

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

async fn connect_ready(
    url: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut ws, _r) = tokio_tungstenite::connect_async(url).await.unwrap();
    ws.send(Message::Text(
        json!({ "type": "hello", "protocol_version": 1 })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let welcome = recv_text(&mut ws).await;
    assert_eq!(welcome["type"], "welcome");
    ws
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

async fn send_command(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    id: &str,
    session_id: &str,
    command_type: &str,
    payload: Value,
) {
    ws.send(Message::Text(
        json!({
            "id": id,
            "session_id": session_id,
            "type": command_type,
            "payload": payload,
            "v": 1,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
}

/// Read frames until we see the ack matching `id`, ignoring intermediate events.
async fn await_ack(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    id: &str,
) -> Value {
    for _ in 0..10 {
        let v = recv_text(ws).await;
        if v.get("ackOf") == Some(&json!(id)) {
            return v;
        }
    }
    panic!("did not receive ack for {id}");
}

async fn create_session(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> String {
    send_command(
        ws,
        "cmd_session_create_for_assessment",
        "",
        "session.create",
        json!({ "profile_id": "executor.code@1.0.0", "project_root": "/tmp/project" }),
    )
    .await;
    let mut got_ack = false;
    let mut session_id = String::new();
    for _ in 0..6 {
        let v = recv_text(ws).await;
        if v.get("ackOf") == Some(&json!("cmd_session_create_for_assessment")) {
            assert_eq!(v["ok"], true);
            got_ack = true;
        } else if v["type"] == "session.ready" {
            session_id = v["session_id"].as_str().unwrap().to_string();
        }
        if got_ack && !session_id.is_empty() {
            break;
        }
    }
    assert!(
        got_ack && !session_id.is_empty(),
        "session.create did not yield session"
    );
    session_id
}

// ---- assessment.list_runs ----

#[tokio::test]
async fn assessment_list_runs_without_persistence_returns_disabled() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_list_runs_no_persistence",
        &session_id,
        "assessment.list_runs",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_list_runs_no_persistence").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "persistence.disabled");
}

// ---- assessment.fetch_report ----

#[tokio::test]
async fn assessment_fetch_report_rejects_missing_run_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_fetch_report_missing_run_id",
        &session_id,
        "assessment.fetch_report",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_fetch_report_missing_run_id").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
}

#[tokio::test]
async fn assessment_fetch_report_with_run_id_returns_disabled_without_persistence() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_fetch_report_disabled",
        &session_id,
        "assessment.fetch_report",
        json!({ "run_id": "run_does_not_exist" }),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_fetch_report_disabled").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "persistence.disabled");
}

// ---- assessment.replay ----

#[tokio::test]
async fn assessment_replay_rejects_missing_run_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_replay_missing_run_id",
        &session_id,
        "assessment.replay",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_replay_missing_run_id").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
}

// ---- assessment.diff ----

#[tokio::test]
async fn assessment_diff_rejects_missing_base_run_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_diff_missing_base",
        &session_id,
        "assessment.diff",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_diff_missing_base").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
    assert!(ack["error"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("base_run_id"));
}

#[tokio::test]
async fn assessment_diff_rejects_missing_next_run_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_diff_missing_next",
        &session_id,
        "assessment.diff",
        json!({ "base_run_id": "run_a" }),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_diff_missing_next").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
    assert!(ack["error"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("next_run_id"));
}

// ---- assessment.fetch_evidence_preview ----

#[tokio::test]
async fn assessment_fetch_evidence_preview_rejects_missing_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_evidence_preview_missing_id",
        &session_id,
        "assessment.fetch_evidence_preview",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_evidence_preview_missing_id").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
}

// ---- assessment.sweep.cancel ----

#[tokio::test]
async fn assessment_sweep_cancel_rejects_missing_sweep_id() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_sweep_cancel_missing_id",
        &session_id,
        "assessment.sweep.cancel",
        json!({}),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_sweep_cancel_missing_id").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.invalid_payload");
}

#[tokio::test]
async fn assessment_sweep_cancel_unknown_id_returns_not_found() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_sweep_cancel_unknown",
        &session_id,
        "assessment.sweep.cancel",
        json!({ "sweep_id": "sweep_does_not_exist" }),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_sweep_cancel_unknown").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "assessment.not_found");
}

// ---- assessment.run ----

#[tokio::test]
async fn assessment_run_rejects_unknown_session() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    // Skip session.create so we can use a bogus session_id.

    send_command(
        &mut ws,
        "cmd_run_unknown_session",
        "sess_does_not_exist",
        "assessment.run",
        json!({ "swarm": "rtd", "depth": "quick" }),
    )
    .await;
    let ack = await_ack(&mut ws, "cmd_run_unknown_session").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "session.not_found");
}
