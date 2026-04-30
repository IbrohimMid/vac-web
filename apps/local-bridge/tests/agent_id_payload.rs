//! Stage X.4 — additive `agent_id` field on session.create.
//!
//! Coverage:
//!   - Old payload (no agent_id) still creates a session under the
//!     bridge's default agent — additive change must not break v1
//!     clients.
//!   - Unknown `agent_id` returns `agent.not_registered`.
//!   - Disabled `agent_id` returns `agent.disabled`.
//!   - When the requested `agent_id` resolves but the resulting kind
//!     isn't in the profile's `allowed_agent_kinds`, the X.2 deny
//!     `agent.kind_not_allowed` fires *against the resolved agent*,
//!     not the default.
//!   - `session.ready` payload carries `agent_id` + `agent_kind`.

#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::agent_runtime::{
    AgentDefinition, AgentKind, AgentRuntimeRegistry, AgentsConfig, ConfigSource,
    DEFAULT_PERMISSION_TIMEOUT_MS,
};
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

fn target_root() -> PathBuf {
    let m = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    m.parent().unwrap().parent().unwrap().to_path_buf()
}

fn mock_engine_bin() -> PathBuf {
    let root = target_root();
    for p in [
        root.join("target/debug/mock-engine"),
        root.join("target/release/mock-engine"),
    ] {
        if p.exists() {
            return p;
        }
    }
    panic!("mock-engine missing")
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
    panic!("mock-acp missing")
}

/// Build a multi-agent registry with `mock` (default), `claude` (acp),
/// and `disabled-claude` (acp, enabled=false). Used to exercise every
/// X.4 selection branch from one bridge.
fn multi_agent_registry() -> AgentRuntimeRegistry {
    let mock = AgentDefinition {
        id: "mock".into(),
        label: "Mock".into(),
        kind: AgentKind::Mock,
        command: mock_engine_bin(),
        args: vec!["--stdio".into()],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
        mcp_servers: vec![],
    };
    let claude = AgentDefinition {
        id: "claude".into(),
        label: "Claude (mock-acp)".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args: vec!["--acp".into()],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
        mcp_servers: vec![],
    };
    let disabled = AgentDefinition {
        id: "disabled-claude".into(),
        label: "Disabled".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args: vec!["--acp".into()],
        enabled: false,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
        mcp_servers: vec![],
    };
    let cfg = AgentsConfig {
        default_agent_id: "mock".into(),
        agents: vec![mock, claude, disabled],
        registry_source: None,
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}

async fn start_bridge(registry: AgentRuntimeRegistry) -> (String, Arc<AppState>) {
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
        handoff: Arc::new(HandoffService::new()),
        persistence: None,
        persistence_health: PersistenceHealth::default(),
        resume_policy: std::sync::Arc::new(local_bridge::config::SessionResumePolicy::default()),
        config_snapshot: std::sync::Arc::new(tokio::sync::RwLock::new(local_bridge::config::ConfigSnapshot::default())),
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
    let _ = tokio::time::timeout(T, ws.next()).await.unwrap();
    ws
}

async fn send_create(ws: &mut Ws, id: &str, payload: Value) {
    let cmd = json!({
        "v": 1,
        "id": id,
        "type": "session.create",
        "session_id": "",
        "payload": payload
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
}

async fn read_until_ack(ws: &mut Ws, ack_of: &str) -> Value {
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed");
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

async fn read_until_event(ws: &mut Ws, ty: &str) -> Value {
    loop {
        let Some(msg) = tokio::time::timeout(T, ws.next()).await.unwrap() else {
            panic!("ws closed waiting for {ty}");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!(ty)) {
            return v;
        }
    }
}

#[tokio::test]
async fn x4_old_payload_without_agent_id_still_works() {
    let (url, _state) = start_bridge(multi_agent_registry()).await;
    let mut ws = connect_hello(&url).await;
    // Old payload: no agent_id field at all.
    send_create(
        &mut ws,
        "c1",
        json!({ "profile_id": "assessor.rtd@1.0.0", "project_root": "/tmp/x" }),
    )
    .await;
    let ready = read_until_event(&mut ws, "session.ready").await;
    assert_eq!(ready["payload"]["agent_id"], json!("mock"));
    assert_eq!(ready["payload"]["agent_kind"], json!("mock"));
}

#[tokio::test]
async fn x4_explicit_agent_id_routes_to_acp() {
    let (url, _state) = start_bridge(multi_agent_registry()).await;
    let mut ws = connect_hello(&url).await;
    send_create(
        &mut ws,
        "c1",
        json!({
            "profile_id": "executor.code@1.0.0",
            "project_root": "/tmp/x",
            "agent_id": "claude"
        }),
    )
    .await;
    let ready = read_until_event(&mut ws, "session.ready").await;
    assert_eq!(ready["payload"]["agent_id"], json!("claude"));
    assert_eq!(ready["payload"]["agent_kind"], json!("acp"));
}

#[tokio::test]
async fn x4_unknown_agent_id_errors() {
    let (url, _state) = start_bridge(multi_agent_registry()).await;
    let mut ws = connect_hello(&url).await;
    send_create(
        &mut ws,
        "c1",
        json!({
            "profile_id": "executor.code@1.0.0",
            "project_root": "/tmp/x",
            "agent_id": "ghost"
        }),
    )
    .await;
    let ack = read_until_ack(&mut ws, "c1").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("agent.not_registered"));
}

#[tokio::test]
async fn x4_disabled_agent_id_errors() {
    let (url, _state) = start_bridge(multi_agent_registry()).await;
    let mut ws = connect_hello(&url).await;
    send_create(
        &mut ws,
        "c1",
        json!({
            "profile_id": "executor.code@1.0.0",
            "project_root": "/tmp/x",
            "agent_id": "disabled-claude"
        }),
    )
    .await;
    let ack = read_until_ack(&mut ws, "c1").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("agent.disabled"));
}

#[tokio::test]
async fn x4_registry_create_with_agent_rejects_disabled_at_lower_level() {
    // Defense-in-depth: even if a future caller bypasses the
    // translator's `agent.disabled` ack path, SessionRegistry must
    // refuse to spawn a disabled agent. We invoke the registry
    // directly, no WS, no translator.
    let (_url, state) = start_bridge(multi_agent_registry()).await;
    let result = state
        .sessions
        .create_with_agent(
            "executor.code@1.0.0".into(),
            std::path::PathBuf::from("/tmp/x"),
            Some("disabled-claude"),
        )
        .await;
    let err = match result {
        Ok(_) => panic!("disabled agent must not spawn"),
        Err(e) => e,
    };
    let msg = err.to_string();
    assert!(msg.contains("agent.disabled"), "unexpected error: {msg}");
    assert_eq!(state.sessions.count(), 0, "no session should be tracked");
}

#[tokio::test]
async fn x4_explicit_acp_against_assessor_profile_denied_by_x2() {
    // X.4 selects the agent; X.2 denies the kind/profile combo.
    let (url, _state) = start_bridge(multi_agent_registry()).await;
    let mut ws = connect_hello(&url).await;
    send_create(
        &mut ws,
        "c1",
        json!({
            "profile_id": "assessor.rtd@1.0.0",
            "project_root": "/tmp/x",
            "agent_id": "claude"
        }),
    )
    .await;
    let ack = read_until_ack(&mut ws, "c1").await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("agent.kind_not_allowed"));
}
