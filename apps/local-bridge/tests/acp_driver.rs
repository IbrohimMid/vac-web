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
    DEFAULT_PERMISSION_TIMEOUT_MS,
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
    let mut args = vec!["--acp".to_string()];
    args.extend(extra_args);
    let agent = AgentDefinition {
        id: "claude-mock".into(),
        label: "Mock ACP".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args,
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
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
async fn x3_acp_session_streams_transcript_delta() {
    let (url, state) = start_bridge_with(build_acp_registry(vec![])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    // Drive the ACP child directly via the SessionHandle. message.submit
    // normalization for ACP belongs to a later stage (X.5 wires tool
    // envelopes); for the scaffold we just inject the line.
    let handle = state
        .sessions
        .get(&session_id)
        .expect("session handle must exist after session.ready");
    handle
        .send_to_engine(
            &serde_json::to_string(&json!({
                "type": "prompt",
                "text": "hello world"
            }))
            .unwrap(),
        )
        .await
        .unwrap();

    let delta = next_event_of_type(&mut ws, "transcript.delta").await;
    assert!(
        delta["payload"]["delta"].is_string(),
        "expected delta string payload: {delta}"
    );
    let _completed = next_event_of_type(&mut ws, "transcript.completed").await;
}

#[tokio::test]
async fn x3_acp_child_crash_emits_transcript_error() {
    // Start mock-acp with --crash-after 1 so it exits non-zero after
    // emitting one chunk. Bridge should surface transcript.error.
    let (url, state) =
        start_bridge_with(build_acp_registry(vec!["--crash-after".into(), "1".into()])).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let handle = state.sessions.get(&session_id).unwrap();
    handle
        .send_to_engine(
            &serde_json::to_string(&json!({ "type": "prompt", "text": "boom" })).unwrap(),
        )
        .await
        .unwrap();
    let err = next_event_of_type(&mut ws, "transcript.error").await;
    assert_eq!(err["payload"]["reason"], json!("child_exited"));
    assert_eq!(err["payload"]["agent_kind"], json!("acp"));
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
