//! Phase 1.1+1.2+1.3+1.4 smoke: spawn bridge, connect WS, exchange envelopes,
//! verify session.create + message.submit + streaming + auth + ring replay.

// Axum 0.7 Message::Text <-> Utf8Bytes conversion.
#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::handoff::HandoffService;
use local_bridge::server::{build_app, AppState};
use local_bridge::session::persistence::PersistenceHealth;
use local_bridge::session::SessionRegistry;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

const T: Duration = Duration::from_secs(5);
static VAC_CONFIG_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
        persistence: None,
        persistence_health: PersistenceHealth::default(),
        resume_policy: std::sync::Arc::new(local_bridge::config::SessionResumePolicy::default()),
        config_snapshot: std::sync::Arc::new(tokio::sync::RwLock::new(
            local_bridge::config::ConfigSnapshot::default(),
        )),
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

struct EnvVarGuard {
    key: &'static str,
    old: Option<String>,
}

impl EnvVarGuard {
    fn set_path(key: &'static str, value: &Path) -> Self {
        let old = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, old }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.old {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

fn write_file(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(p, body).unwrap();
}

fn write_valid_config(root: &Path, default_mode: &str) {
    write_file(root, "vac.yaml", "version: 1\n");
    write_file(
        root,
        "agents/registry.yaml",
        "version: 1\nagents:\n  - id: mock\n    kind: generic\n    default: true\n",
    );
    write_file(
        root,
        "mcp/servers.yaml",
        "version: 1\nservers:\n  - id: fs\n    transport: stdio\n    command: mock-mcp\n",
    );
    write_file(
        root,
        "sessions/resume-policy.yaml",
        &format!(
            "version: 1\nsession_resume:\n  default_mode: {default_mode}\n  native_fallback: replay_only\n  mcp_server_drift: warn\n  profile_class_mismatch: fail\n  retention_days: 21\n  max_events: 3000\n"
        ),
    );
}

async fn connect_ready(
    url: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut ws = connect(url).await;
    send_text(&mut ws, json!({ "type": "hello", "protocol_version": 1 })).await;
    let welcome = recv_text(&mut ws).await;
    assert_eq!(welcome["type"], "welcome");
    ws
}

async fn drive_config_command(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    id: &str,
    command_type: &str,
) -> (Value, Vec<Value>) {
    send_text(
        ws,
        json!({
            "id": id,
            "session_id": "",
            "type": command_type,
            "payload": {},
            "v": 1,
        }),
    )
    .await;

    let mut ack: Option<Value> = None;
    let mut events: Vec<Value> = Vec::new();
    for _ in 0..6 {
        let v = recv_text(ws).await;
        if v.get("ackOf") == Some(&json!(id)) {
            ack = Some(v);
        } else if v
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .starts_with("config.")
        {
            events.push(v);
        }
        let has_terminal = events.iter().any(|e| {
            matches!(
                e.get("type").and_then(|t| t.as_str()),
                Some("config.validated")
                    | Some("config.validate.failed")
                    | Some("config.reloaded")
                    | Some("config.reload_failed")
            )
        });
        if ack.is_some() && has_terminal {
            break;
        }
    }
    (ack.expect("expected ack"), events)
}

#[tokio::test]
async fn config_validate_emits_live_snapshot_event() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect_ready(&url).await;

    let (ack, events) =
        drive_config_command(&mut ws, "cmd_config_validate", "config.validate").await;
    assert_eq!(ack["ok"], true);
    let validated = events
        .iter()
        .find(|e| e["type"] == "config.validated")
        .expect("config.validated event");
    assert_eq!(validated["payload"]["ok"], true);
    assert_eq!(validated["payload"]["active_snapshot_retained"], false);
    assert!(validated["payload"]["policy"]["default_mode"].is_string());
}

#[tokio::test]
async fn config_reload_success_emits_started_then_reloaded_snapshot() {
    let _env_lock = VAC_CONFIG_ENV_LOCK.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    write_valid_config(tmp.path(), "native_or_replay");
    let _env = EnvVarGuard::set_path("VAC_CONFIG_DIR", tmp.path());

    let (url, _state) = start_bridge().await;
    let mut ws = connect_ready(&url).await;

    let (ack, events) =
        drive_config_command(&mut ws, "cmd_config_reload_ok", "config.reload").await;
    assert_eq!(ack["ok"], true);
    assert_eq!(
        events.first().and_then(|e| e["type"].as_str()),
        Some("config.reload.started")
    );
    let reloaded = events
        .iter()
        .find(|e| e["type"] == "config.reloaded")
        .expect("config.reloaded event");
    assert_eq!(reloaded["payload"]["ok"], true);
    assert_eq!(reloaded["payload"]["active_snapshot_retained"], false);
    assert_eq!(
        reloaded["payload"]["policy"]["default_mode"],
        "native_or_replay"
    );
    assert_eq!(reloaded["payload"]["agents"]["count"], 1);
    assert_eq!(reloaded["payload"]["mcp"]["count"], 1);
}

#[tokio::test]
async fn config_reload_failed_retains_previous_snapshot_contract() {
    let _env_lock = VAC_CONFIG_ENV_LOCK.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    write_valid_config(tmp.path(), "replay_only");
    let _env = EnvVarGuard::set_path("VAC_CONFIG_DIR", tmp.path());

    let (url, state) = start_bridge().await;
    let mut ws = connect_ready(&url).await;

    let (seed_ack, seed_events) =
        drive_config_command(&mut ws, "cmd_config_reload_seed", "config.reload").await;
    assert_eq!(seed_ack["ok"], true);
    let seed_reloaded = seed_events
        .iter()
        .find(|e| e["type"] == "config.reloaded")
        .expect("seed config.reloaded event");
    assert_eq!(
        seed_reloaded["payload"]["policy"]["default_mode"],
        "replay_only"
    );

    fs::write(
        tmp.path().join("agents/registry.yaml"),
        "this is not: [valid yaml",
    )
    .unwrap();

    let (ack, events) =
        drive_config_command(&mut ws, "cmd_config_reload_bad", "config.reload").await;
    assert_eq!(ack["ok"], false);
    assert_eq!(ack["error"]["code"], "config.reload_failed");
    assert_eq!(
        events.first().and_then(|e| e["type"].as_str()),
        Some("config.reload.started")
    );
    let failed = events
        .iter()
        .find(|e| e["type"] == "config.reload_failed")
        .expect("config.reload_failed event");
    assert_eq!(failed["payload"]["ok"], false);
    assert_eq!(failed["payload"]["active_snapshot_retained"], true);
    assert!(failed["payload"]["last_reload_failed_at"].is_string());
    assert!(failed["payload"]["last_successful_loaded_at"].is_string());
    assert!(!failed["payload"]["diagnostics"]
        .as_array()
        .unwrap()
        .is_empty());

    let snap = state.config_snapshot.read().await;
    assert!(!snap.ok);
    assert!(snap.active_snapshot_retained);
    assert_eq!(snap.resume_policy.default_mode.as_str(), "replay_only");
    assert_eq!(snap.agents.count, 1, "previous agent summary retained");
}

#[tokio::test]
async fn handshake_welcome() {
    let (url, _state) = start_bridge().await;
    let mut ws = connect(&url).await;
    send_text(&mut ws, json!({ "type": "hello", "protocol_version": 1 })).await;
    let welcome = recv_text(&mut ws).await;
    assert_eq!(welcome["type"], "welcome");
    assert_eq!(welcome["protocol_version"], 1);
    // Stage X.5e: welcome must advertise the live agent runtime
    // registry so the cockpit can render a provider picker without a
    // separate HTTP roundtrip. The mock test bridge synthesizes a
    // single legacy agent, so we only assert shape + default flag.
    let agents = welcome["available_agents"]
        .as_array()
        .expect("available_agents present");
    assert!(!agents.is_empty(), "at least one agent advertised");
    let defaults: Vec<&serde_json::Value> =
        agents.iter().filter(|a| a["default"] == true).collect();
    assert_eq!(defaults.len(), 1, "exactly one default agent");
    for a in agents {
        assert!(a["id"].is_string());
        assert!(a["label"].is_string());
        assert!(a["kind"].is_string());
        assert!(a["default"].is_boolean());
    }
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
