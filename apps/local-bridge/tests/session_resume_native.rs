//! Stage X6 batch B — persistence-backed native resume E2E tests.
//!
//! These tests close the integration-coverage gap left by
//! `session_resume_modes.rs` (which only covers no-persistence dispatch
//! cells) and `registry.rs::resume_native`'s unit tests (which only
//! cover B4 validation failures). They exercise the full
//! `session.resume` flow end to end:
//!
//!   * a real `FilePersistence` is wired into `AppState` so the bridge
//!     can read `PersistedSessionMeta` and append replayed events;
//!   * a real `mock-acp` child process is spawned to drive the
//!     `session/load` happy-path (B2) and the unsupported-method-error
//!     path (B3 fallback / B4 hard reject);
//!   * the WS client observes the resume lifecycle exactly as the
//!     cockpit would: `session.resume.initializing`,
//!     `vac.session_resumed_native`, replayed `transcript.delta`s, and
//!     finally `session.resumed { native, resume_mode, ... }`.
//!
//! Coverage matrix:
//!
//! | Test                                                       | Mock flags          | meta.caps  | mode               | Expected outcome                                            |
//! | ---------------------------------------------------------- | ------------------- | ---------- | ------------------ | ----------------------------------------------------------- |
//! | `x6_native_resume_acp_load_success_replays_updates`         | `--load-session`    | true       | `acp_load`         | ack ok, native marker, replayed updates, `native=true`      |
//! | `x6_native_or_replay_unsupported_falls_back_to_replay`      | (none)              | true       | `native_or_replay` | ack ok, no native marker, replay progress, fallback resumed |
//! | `x6_acp_load_unsupported_hard_fails`                        | (none)              | true       | `acp_load`         | ack false, `native_resume_unsupported`, no replay           |
//!
//! Note on the WS subscription: the resume command's `cmd.session_id`
//! is `"sess_pre"` (placeholder — there is no live session yet). The
//! bridge's auto-subscribe path attaches to the resumed session's
//! per-handle broadcast on `session.resumed` (added in this batch),
//! and the translator drains the per-handle ring for the immediate
//! lifecycle batch. Together that means the FE client sees every
//! event without needing a follow-up `replay.request` round-trip.

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
use local_bridge::session::persistence::{
    FilePersistence, PersistedServerEvent, PersistedSessionMeta, PersistedSessionStatus,
    PersistenceHealth, PersistenceNativeResume, PersistenceVersion, RedactionLabel,
    SessionPersistence,
};
use local_bridge::session::SessionRegistry;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// Harness primitives
// ---------------------------------------------------------------------------

/// Hard ceiling for any single ws read that's expected to succeed.
/// Generous enough for cold-start spawn of `mock-acp` on a slow CI
/// box; far below cargo test's default 60s task timeout.
const T: Duration = Duration::from_secs(20);

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

fn load_session_fixture(name: &str) -> PathBuf {
    target_root()
        .join("tools/mock-acp/fixtures/load-session")
        .join(name)
}

fn profile_root() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/protocol/v1/profiles"
    ))
}

/// Build a single-agent ACP registry pointed at `mock-acp`. Extra CLI
/// flags are appended after the canonical `--acp` flag so callers can
/// switch the mock agent between the fixture-driven happy path and
/// the unsupported-method-error path without rebuilding the binary.
fn build_acp_registry(extra_args: Vec<String>) -> AgentRuntimeRegistry {
    let mut args = vec!["--acp".to_string()];
    args.extend(extra_args);
    let agent = AgentDefinition {
        id: "mock-acp".into(),
        label: "Mock ACP".into(),
        kind: AgentKind::Acp,
        command: mock_acp_bin(),
        args,
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

struct Harness {
    url: String,
    state: Arc<AppState>,
    persistence: Arc<dyn SessionPersistence>,
    project_root: PathBuf,
    /// TempDirs are kept alive on the harness so the underlying
    /// directories survive for the whole test. We intentionally do
    /// *not* `mem::forget` them — each test gets a fresh harness and
    /// the dirs clean up on drop.
    _project_root_keepalive: tempfile::TempDir,
    _persistence_root_keepalive: tempfile::TempDir,
    _audit_root_keepalive: tempfile::TempDir,
}

/// Spin up a bridge with a real `FilePersistence` wired into
/// `AppState`. The mock-acp child is configured via `extra_mock_args`
/// (e.g. `["--load-session", "<fixture>"]` for the B2 happy path or
/// `[]` for the unsupported-method path used by B3 and B4).
async fn start_bridge_with_persistence(extra_mock_args: Vec<String>) -> Harness {
    let registry = build_acp_registry(extra_mock_args);
    let audit_dir = tempfile::tempdir().unwrap();
    let audit = Arc::new(AuditFacility::new(audit_dir.path().to_path_buf()));
    let persistence_dir = tempfile::tempdir().unwrap();
    let persistence: Arc<dyn SessionPersistence> =
        Arc::new(FilePersistence::open(persistence_dir.path()).unwrap());
    let project_root = tempfile::tempdir().unwrap();
    let project_root_path = project_root.path().to_path_buf();

    let sessions = SessionRegistry::with_runtime_and_profiles(Arc::new(registry), profile_root());
    sessions.attach_audit(Arc::clone(&audit));
    sessions.attach_persistence(Arc::clone(&persistence));
    let health = PersistenceHealth::default();
    sessions.attach_persistence_health(health.clone());

    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions,
        auth: AuthState::new_dev(),
        audit,
        pairing: PairingStore::new(),
        profile_root: profile_root(),
        handoff: Arc::new(HandoffService::new()),
        persistence: Some(Arc::clone(&persistence)),
        persistence_health: health,
        assessment_index: None,
        resume_policy: std::sync::Arc::new(local_bridge::config::SessionResumePolicy::default()),
        config_snapshot: std::sync::Arc::new(tokio::sync::RwLock::new(
            local_bridge::config::ConfigSnapshot::default(),
        )),
    });

    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Harness {
        url: format!("ws://{}/api/sessions/stream", addr),
        state,
        persistence,
        project_root: project_root_path,
        _project_root_keepalive: project_root,
        _persistence_root_keepalive: persistence_dir,
        _audit_root_keepalive: audit_dir,
    }
}

/// Persist a `PersistedSessionMeta` row as if a previous `session/new`
/// against `mock-acp` had completed. The shape is the minimum the
/// bridge needs to take the `caps_supported` branch on resume:
///
///   * `agent_id` matches the registry agent built by
///     `build_acp_registry` (`"mock-acp"`),
///   * `agent_kind` matches `AgentKind::Acp.as_str()`,
///   * `agent_session_id` is `Some(...)` (translator rejects `None`
///     with `vac_session_unknown`),
///   * `profile_id` resolves to a real shipped profile YAML so the
///     C2/C3 strict validation tier passes,
///   * `native_resume.load_session_supported = true` so the translator
///     enters the resume_native code path even when the live agent's
///     `initialize` reply advertises `loadSession=false` (the bridge
///     trusts persisted meta over re-probing init).
fn make_meta(
    vac_session_id: &str,
    project_root: &std::path::Path,
    load_session_supported: bool,
) -> PersistedSessionMeta {
    let now = chrono::Utc::now();
    PersistedSessionMeta {
        version: PersistenceVersion::default(),
        vac_session_id: vac_session_id.to_string(),
        agent_session_id: Some(format!("mock_acp_{vac_session_id}")),
        agent_id: "mock-acp".to_string(),
        agent_kind: "acp".to_string(),
        project_root: project_root.to_path_buf(),
        // executor.code allows agent kind `acp` (assessor profiles
        // restrict to mock + vac-native), so the C3 strict
        // `enforce_agent_kind` check inside `resume_native` accepts
        // the persisted ACP-backed session. Switching profiles here
        // also exercises the C2 `CapabilityProfile::load` parse path
        // against a real shipped YAML.
        profile_id: "executor.code@1.0.0".to_string(),
        workflow_id: None,
        created_at: now,
        updated_at: now,
        status: PersistedSessionStatus::Active,
        native_resume: PersistenceNativeResume {
            load_session_supported,
            last_verified_at: if load_session_supported {
                Some(now)
            } else {
                None
            },
        },
        mcp_servers: Vec::new(),
        agent_capabilities: json!({"loadSession": load_session_supported}),
        // Stage R2 — the shipped `executor.code@1.0.0` profile
        // parses to class `executor`, so seed a matching persisted
        // class. The R2 unit tests in this file that exercise
        // mismatch / missing paths construct meta inline rather
        // than going through `make_meta`.
        profile_class: Some("executor".to_string()),
    }
}

fn replay_event(seq: u64, event_type: &str, payload: Value) -> PersistedServerEvent {
    PersistedServerEvent {
        seq,
        event_type: event_type.to_string(),
        payload,
        ts: chrono::Utc::now(),
        redaction: RedactionLabel::Safe,
    }
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
    // Drain the welcome frame so it doesn't pollute later asserts.
    let _ = tokio::time::timeout(T, ws.next()).await.unwrap();
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

/// Drive a `session.resume` and collect the ack + every server event
/// the bridge emits on the WS.
///
/// The drain loop intentionally keeps reading after the ack lands
/// because the native resume path streams `session/update`
/// notifications from the mock-acp child *asynchronously*: some
/// `transcript.delta` events reach the per-session broadcast after
/// the ring snapshot taken inside `dispatch_command`. The translator
/// drains the ring on Started, and the WS auto-subscribes on
/// `session.resumed` so those late events still reach the client.
/// `quiet_window` is the post-ack idle gap we tolerate before
/// declaring "no more events" — 750ms is enough for the fixture pump
/// on a debug build without padding the test by full seconds.
async fn drive_resume(ws: &mut Ws, payload: Value, quiet_window: Duration) -> (Value, Vec<Value>) {
    send(
        ws,
        json!({
            "id": "cmd_resume",
            "session_id": "sess_pre",
            "type": "session.resume",
            "payload": payload,
            "v": 1,
        }),
    )
    .await;

    let mut ack: Option<Value> = None;
    let mut events: Vec<Value> = Vec::new();
    let hard_deadline = Instant::now() + T;
    loop {
        let now = Instant::now();
        let timeout_dur = if ack.is_some() {
            quiet_window
        } else if now >= hard_deadline {
            break;
        } else {
            hard_deadline - now
        };
        let next = tokio::time::timeout(timeout_dur, ws.next()).await;
        match next {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = match serde_json::from_str(&t) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("ackOf") == Some(&json!("cmd_resume")) {
                    ack = Some(v);
                } else if v.get("type").is_some() {
                    events.push(v);
                }
            }
            Ok(Some(Ok(Message::Ping(_)))) | Ok(Some(Ok(Message::Pong(_)))) => continue,
            Ok(Some(Ok(_))) => continue,
            // Timeout (post-ack quiet window expired) or ws closed /
            // transport error — either way, we're done draining.
            _ => break,
        }
    }
    (ack.expect("never received ack for session.resume"), events)
}

fn find_event<'a>(events: &'a [Value], event_type: &str) -> Option<&'a Value> {
    events
        .iter()
        .find(|e| e.get("type") == Some(&json!(event_type)))
}

fn count_event(events: &[Value], event_type: &str) -> usize {
    events
        .iter()
        .filter(|e| e.get("type") == Some(&json!(event_type)))
        .count()
}

// ---------------------------------------------------------------------------
// B2 — happy path: persisted meta + `--load-session` fixture drive a
// successful `session/load`. The fixture's `events.jsonl` is streamed
// from mock-acp as `session/update` notifications, which the bridge's
// pump task converts to `transcript.delta` ServerEvents on the
// per-handle broadcast.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn x6_native_resume_acp_load_success_replays_updates() {
    let fixture_dir = load_session_fixture("basic");
    assert!(
        fixture_dir.join("events.jsonl").exists(),
        "missing fixture {fixture_dir:?}/events.jsonl"
    );
    let h = start_bridge_with_persistence(vec![
        "--load-session".to_string(),
        fixture_dir.display().to_string(),
    ])
    .await;
    let vac_session_id = "sess_x6_b2_native_happy";
    let meta = make_meta(vac_session_id, &h.project_root, true);
    h.persistence.save_meta(&meta).unwrap();

    let mut ws = connect_hello(&h.url).await;
    let (ack, events) = drive_resume(
        &mut ws,
        json!({
            "vac_session_id": vac_session_id,
            "resume_mode": "acp_load",
        }),
        Duration::from_millis(750),
    )
    .await;

    assert_eq!(
        ack["ok"],
        json!(true),
        "ack must succeed for native resume happy path: {ack}"
    );

    // Lifecycle markers — the cockpit's resume chip transitions on
    // exactly these event types.
    assert!(
        find_event(&events, "session.resume.initializing").is_some(),
        "missing session.resume.initializing in {events:#?}"
    );
    assert!(
        find_event(&events, "vac.session_resumed_native").is_some(),
        "missing vac.session_resumed_native in {events:#?}"
    );
    let resumed = find_event(&events, "session.resumed")
        .unwrap_or_else(|| panic!("missing session.resumed event in {events:#?}"));
    assert_eq!(
        resumed["payload"]["native"],
        json!(true),
        "session.resumed.native must be true on happy path"
    );
    assert_eq!(
        resumed["payload"]["resume_mode"],
        json!("native"),
        "resume_mode on happy path must be 'native'"
    );

    // Replayed `session/update` notifications from the fixture must
    // reach the WS as `transcript.delta` events. The basic fixture
    // ships 3 lines (1 user + 2 agent). We only require >= 2 to keep
    // the assertion robust against minor fixture edits.
    let delta_count = count_event(&events, "transcript.delta");
    assert!(
        delta_count >= 2,
        "expected at least 2 transcript.delta events from fixture replay, got {delta_count} in {events:#?}"
    );

    // The session must end up in the live registry so subsequent
    // commands (transcript writes, kill, etc.) can target it without
    // a fresh resume.
    assert!(
        h.state.sessions.get(vac_session_id).is_some(),
        "active session must be registered after native resume"
    );
}

// ---------------------------------------------------------------------------
// B3 — fallback path: meta records `load_session_supported = true`,
// but the live mock-acp (run without `--load-session`) returns
// `-32601` (method not found) for the `session/load` call. For
// `mode = native_or_replay` the bridge MUST downgrade to persistence
// replay rather than hard-fail.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn x6_native_or_replay_unsupported_falls_back_to_replay() {
    let h = start_bridge_with_persistence(vec![]).await;
    let vac_session_id = "sess_x6_b3_native_or_replay";
    let meta = make_meta(vac_session_id, &h.project_root, true);
    h.persistence.save_meta(&meta).unwrap();

    // Pre-populate a few replayable events so the fallback path has
    // concrete content to stream and the `replayed_events` count on
    // `session.resumed` is non-zero (which is what the FE chip
    // displays on the "replay fallback" subtitle).
    for i in 0..3u64 {
        h.persistence
            .append_event(
                vac_session_id,
                &replay_event(
                    i,
                    "transcript.delta",
                    json!({"delta": format!("replay-{i}")}),
                ),
            )
            .unwrap();
    }

    let mut ws = connect_hello(&h.url).await;
    let (ack, events) = drive_resume(
        &mut ws,
        json!({
            "vac_session_id": vac_session_id,
            "resume_mode": "native_or_replay",
        }),
        Duration::from_millis(750),
    )
    .await;

    assert_eq!(
        ack["ok"],
        json!(true),
        "native_or_replay ack must succeed via replay fallback: {ack}"
    );

    // No native marker: the agent never satisfied `session/load`, so
    // the user-visible chip must report a non-native restore.
    assert!(
        find_event(&events, "vac.session_resumed_native").is_none(),
        "fallback path must NOT emit vac.session_resumed_native: {events:#?}"
    );

    // Replay path lifecycle: started + at least one progress tick.
    assert!(
        find_event(&events, "session.resume.started").is_some(),
        "missing session.resume.started in fallback path: {events:#?}"
    );
    assert!(
        find_event(&events, "session.replay.progress").is_some(),
        "missing session.replay.progress tick in fallback path: {events:#?}"
    );

    let resumed = find_event(&events, "session.resumed")
        .unwrap_or_else(|| panic!("missing session.resumed event in {events:#?}"));
    assert_eq!(
        resumed["payload"]["native"],
        json!(false),
        "fallback path must report native=false"
    );
    assert_eq!(
        resumed["payload"]["resume_mode"],
        json!("replay_only_fallback"),
        "fallback resume_mode must distinguish from explicit replay_only"
    );
    // The persistence sink also records `session.resume.initializing`
    // emitted by the (failed) native attempt before the fallback
    // kicks in, so the replayed_events count includes that lifecycle
    // event in addition to the 3 we pre-populated. We only assert the
    // floor here — the FE chip cares that *some* events were
    // replayed, not the exact persistence-sink bookkeeping.
    let replayed = resumed["payload"]["replayed_events"]
        .as_u64()
        .expect("replayed_events must be an integer");
    assert!(
        replayed >= 3,
        "fallback path must replay at least the pre-populated 3 events; got {replayed}"
    );
}

// ---------------------------------------------------------------------------
// B4 — hard reject: meta records `load_session_supported = true`,
// the live agent returns `-32601` for `session/load`, but the user
// explicitly requested `acp_load`. The bridge MUST surface
// `session.resume.failed reason=native_resume_unsupported` and MUST
// NOT silently fall back to replay (that would make the two
// user-visible buttons — "Resume native" and "Resume (replay)" —
// behave identically).
// ---------------------------------------------------------------------------
#[tokio::test]
async fn x6_acp_load_unsupported_hard_fails() {
    let h = start_bridge_with_persistence(vec![]).await;
    let vac_session_id = "sess_x6_b4_acp_load_hard_fail";
    let meta = make_meta(vac_session_id, &h.project_root, true);
    h.persistence.save_meta(&meta).unwrap();

    let mut ws = connect_hello(&h.url).await;
    let (ack, events) = drive_resume(
        &mut ws,
        json!({
            "vac_session_id": vac_session_id,
            "resume_mode": "acp_load",
        }),
        Duration::from_millis(500),
    )
    .await;

    assert_eq!(
        ack["ok"],
        json!(false),
        "acp_load hard reject ack must be false: {ack}"
    );
    assert_eq!(
        ack["error"]["code"],
        json!("session.native_resume_unsupported"),
        "acp_load hard reject must surface a typed ack code"
    );

    let failed = find_event(&events, "session.resume.failed")
        .unwrap_or_else(|| panic!("missing session.resume.failed event in {events:#?}"));
    assert_eq!(
        failed["payload"]["reason"],
        json!("native_resume_unsupported"),
        "failed event reason must be native_resume_unsupported"
    );
    assert_eq!(failed["payload"]["mode"], json!("acp_load"));
    assert_eq!(
        failed["payload"]["vac_session_id"],
        json!(vac_session_id),
        "failed event must echo the requested vac_session_id"
    );

    // Negative assertions — the hard reject path must not leak any
    // markers that would confuse the FE chip into thinking the
    // session was actually restored.
    assert!(
        find_event(&events, "session.resume.started").is_none(),
        "acp_load hard reject must NOT emit session.resume.started: {events:#?}"
    );
    assert!(
        find_event(&events, "session.resumed").is_none(),
        "acp_load hard reject must NOT emit session.resumed: {events:#?}"
    );
    assert!(
        find_event(&events, "vac.session_resumed_native").is_none(),
        "acp_load hard reject must NOT emit vac.session_resumed_native: {events:#?}"
    );
}
