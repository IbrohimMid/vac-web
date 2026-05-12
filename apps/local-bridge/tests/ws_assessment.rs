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
//! Positive-path coverage that exercises the file-backed persistence
//! path lives in the lower half of this file and uses a real
//! `FilePersistence` plus optional `AssessmentIndex`.

#![allow(clippy::useless_conversion)]

use futures::{SinkExt, StreamExt};
use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::handoff::HandoffService;
use local_bridge::server::{build_app, AppState};
use local_bridge::session::persistence::{FilePersistence, PersistenceHealth, SharedPersistence};
use local_bridge::session::SessionRegistry;
use local_bridge::storage::AssessmentIndex;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

const T: Duration = Duration::from_secs(5);

struct Harness {
    url: String,
    persistence: SharedPersistence,
    index: Option<Arc<AssessmentIndex>>,
    _data_root_keepalive: tempfile::TempDir,
}

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

fn make_state(
    sessions: SessionRegistry,
    audit: Arc<AuditFacility>,
    persistence: Option<SharedPersistence>,
    assessment_index: Option<Arc<AssessmentIndex>>,
    persistence_health: PersistenceHealth,
) -> Arc<AppState> {
    Arc::new(AppState {
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
        persistence,
        persistence_health,
        assessment_index,
        resume_policy: std::sync::Arc::new(local_bridge::config::SessionResumePolicy::default()),
        config_snapshot: std::sync::Arc::new(tokio::sync::RwLock::new(
            local_bridge::config::ConfigSnapshot::default(),
        )),
        release_provider: local_bridge::release::ReleaseProvider::default(),
    })
}

async fn start_bridge() -> String {
    let tmp = tempfile::tempdir().unwrap();
    let sessions = SessionRegistry::new(mock_engine_bin());
    let health = PersistenceHealth::default();
    let state = make_state(
        sessions,
        Arc::new(AuditFacility::new(tmp.path().to_path_buf())),
        None,
        None,
        health,
    );
    std::mem::forget(tmp);
    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("ws://{}/api/sessions/stream", addr)
}

async fn start_bridge_with_persistence(with_index: bool) -> Harness {
    let data_root = tempfile::tempdir().unwrap();
    let audit_dir = data_root.path().join("audit");
    std::fs::create_dir_all(&audit_dir).unwrap();
    let audit = Arc::new(AuditFacility::new(audit_dir));
    let health = PersistenceHealth::default();

    let sessions_root = data_root.path().join("sessions");
    let persistence: SharedPersistence =
        Arc::new(FilePersistence::open(&sessions_root).expect("open file persistence"));

    let index = if with_index {
        Some(Arc::new(
            AssessmentIndex::open(data_root.path().join("assessment-index.sqlite"))
                .expect("open assessment index"),
        ))
    } else {
        None
    };

    let sessions = SessionRegistry::new(mock_engine_bin());
    sessions.attach_audit(Arc::clone(&audit));
    sessions.attach_persistence(Arc::clone(&persistence));
    sessions.attach_persistence_health(health.clone());
    if let Some(index) = &index {
        sessions.attach_assessment_index(Arc::clone(index));
    }

    let state = make_state(
        sessions,
        audit,
        Some(Arc::clone(&persistence)),
        index.clone(),
        health,
    );
    let app = build_app(Arc::clone(&state));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    Harness {
        url: format!("ws://{}/api/sessions/stream", addr),
        persistence,
        index,
        _data_root_keepalive: data_root,
    }
}

async fn await_run_completion(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    ack_id: &str,
) -> (Value, Value, Value, usize) {
    let mut ack = None;
    let mut started = None;
    let mut completed = None;
    let mut finding_count = 0usize;
    for _ in 0..60 {
        let v = recv_text(ws).await;
        if v.get("ackOf") == Some(&json!(ack_id)) {
            ack = Some(v);
        } else {
            match v["type"].as_str().unwrap_or("") {
                "assessment.started" => started = Some(v),
                "assessment.finding_added" => finding_count += 1,
                "assessment.completed" => completed = Some(v),
                "assessment.failed" => panic!("unexpected assessment.failed event: {v}"),
                _ => {}
            }
        }
        if ack.is_some() && started.is_some() && completed.is_some() {
            break;
        }
    }

    (
        ack.expect("missing ack"),
        started.expect("missing assessment.started"),
        completed.expect("missing assessment.completed"),
        finding_count,
    )
}

async fn await_query_event(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    ack_id: &str,
    event_types: &[&str],
) -> (Value, Vec<Value>) {
    let mut ack = None;
    let mut events = Vec::new();
    for _ in 0..40 {
        let v = recv_text(ws).await;
        if v.get("ackOf") == Some(&json!(ack_id)) {
            ack = Some(v);
            continue;
        }

        let event_type = v["type"].as_str().unwrap_or("");
        if event_types.contains(&event_type) {
            events.push(v);
        }

        if ack.is_some() && event_types.len() == events.len() {
            break;
        }
    }

    (ack.expect("missing ack"), events)
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
async fn assessment_run_surfaces_worker_output_rejections() {
    let url = start_bridge().await;
    let mut ws = connect_ready(&url).await;
    let session_id = create_session(&mut ws).await;

    let cases = [
        (
            "schema_version_unsupported",
            "schema_version_unsupported",
            "schema_version_unsupported",
            "schema_version",
            Some(r#"{"schema_version":99,"candidates":[]}"#),
            None::<&str>,
        ),
        (
            "candidate_schema_invalid",
            "candidate_schema_invalid",
            "candidate_missing_title",
            "candidates[0].title",
            Some(
                r#"{"schema_version":1,"candidates":[{"category":"technical","severity":"high"}]}"#,
            ),
            None::<&str>,
        ),
        (
            "redaction_applied",
            "redaction_applied",
            "redaction_applied",
            "sample",
            Some(
                r#"{"schema_version":1,"candidates":[{"title":"<redacted>","category":"technical","severity":"high"}]}"#,
            ),
            Some("<redacted>"),
        ),
    ];

    for (
        idx,
        (swarm, expected_reason, expected_code, expected_path, expected_sample, expected_marker),
    ) in cases.iter().enumerate()
    {
        let cmd_id = format!("cmd_run_worker_output_{idx}");
        send_command(
            &mut ws,
            &cmd_id,
            &session_id,
            "assessment.run",
            json!({ "swarm": swarm, "depth": "quick" }),
        )
        .await;

        let mut ack = None;
        let mut started = None;
        let mut rejection = None;
        let mut failed = None;

        for _ in 0..20 {
            let v = recv_text(&mut ws).await;
            if v.get("ackOf") == Some(&json!(cmd_id)) {
                ack = Some(v);
            } else {
                match v["type"].as_str().unwrap_or("") {
                    "assessment.started" => started = Some(v),
                    "assessment.worker_output_rejected" => rejection = Some(v),
                    "assessment.failed" => failed = Some(v),
                    _ => {}
                }
            }
            if ack.is_some() && started.is_some() && rejection.is_some() && failed.is_some() {
                break;
            }
        }

        let ack = ack.expect("missing ack");
        assert_eq!(ack["ok"], true);

        let started = started.expect("missing assessment.started");
        let run_id = started["payload"]["run_id"].as_str().unwrap().to_string();

        let rejection = rejection.expect("missing assessment.worker_output_rejected");
        assert_eq!(rejection["payload"]["run_id"], json!(run_id));
        assert_eq!(rejection["payload"]["reason"], json!(expected_reason));
        assert_eq!(rejection["payload"]["code"], json!(expected_code));
        assert_eq!(rejection["payload"]["path"], json!(expected_path));
        assert_eq!(rejection["payload"]["sample_truncated"], json!(false));
        assert_eq!(rejection["payload"]["pass"], json!(1));
        assert_eq!(rejection["payload"]["max_passes"], json!(1));

        match expected_marker {
            Some(marker) => {
                assert_eq!(
                    rejection["payload"]["sample_reason"],
                    json!("redaction_applied")
                );
                let sample = rejection["payload"]["sample"].as_str().unwrap();
                assert!(sample.contains(marker));
            }
            None => {
                assert!(rejection["payload"].get("sample_reason").is_none());
            }
        }

        if let Some(expected_sample) = expected_sample {
            assert_eq!(rejection["payload"]["sample"], json!(expected_sample));
        }

        let failed = failed.expect("missing assessment.failed");
        assert_eq!(failed["payload"]["run_id"], json!(run_id));
    }
}

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

// ---- positive-path file-backed persistence ----

#[tokio::test]
async fn assessment_run_with_file_persistence_falls_back_to_event_log_without_index() {
    let harness = start_bridge_with_persistence(false).await;
    let mut ws = connect_ready(&harness.url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_run_file_persistence_no_index",
        &session_id,
        "assessment.run",
        json!({ "swarm": "rtd", "depth": "quick" }),
    )
    .await;
    let (ack, started, completed, finding_count) =
        await_run_completion(&mut ws, "cmd_run_file_persistence_no_index").await;

    assert_eq!(ack["ok"], true);
    // This fixture's mock-engine output may be verdict-only depending on the
    // installed test binary. The positive-path contract under test is durable
    // started/completed persistence plus query hydration; findings are covered
    // by dedicated worker-output/candidate tests.
    let _ = finding_count;

    let run_id = started["payload"]["run_id"].as_str().unwrap().to_string();
    assert_eq!(completed["payload"]["run_id"], json!(run_id));
    assert!(
        matches!(
            completed["payload"]["verdict"].as_str(),
            Some("pass" | "warn" | "fail")
        ),
        "assessment.completed should carry a terminal verdict; got {}",
        completed["payload"]["verdict"]
    );

    let persisted = harness
        .persistence
        .load_events(&session_id, 0)
        .expect("load persisted events");
    assert!(
        persisted
            .iter()
            .any(|event| event.event_type == "assessment.started"),
        "canonical JSONL log must contain the run start event"
    );
    assert!(
        persisted
            .iter()
            .any(|event| event.event_type == "assessment.completed"),
        "canonical JSONL log must contain the run completion event"
    );

    send_command(
        &mut ws,
        "cmd_list_runs_file_persistence_no_index",
        &session_id,
        "assessment.list_runs",
        json!({ "limit": 50 }),
    )
    .await;
    let (ack, events) = await_query_event(
        &mut ws,
        "cmd_list_runs_file_persistence_no_index",
        &["assessment.runs_listed"],
    )
    .await;
    assert_eq!(ack["ok"], true);
    let payload = &events[0]["payload"];
    assert_eq!(payload["query_source"], json!("event_log"));
    assert_eq!(payload["fallback_reason"], json!("index_missing"));
    assert_eq!(payload["source"], json!("event_log"));
    assert_eq!(payload["index_complete"], json!(false));
    assert_eq!(payload["runs"][0]["id"], json!(run_id));
}

#[tokio::test]
async fn assessment_run_with_file_persistence_uses_index_for_list_runs_and_event_log_for_report_replay(
) {
    let harness = start_bridge_with_persistence(true).await;
    let mut ws = connect_ready(&harness.url).await;
    let session_id = create_session(&mut ws).await;

    send_command(
        &mut ws,
        "cmd_run_file_persistence_indexed",
        &session_id,
        "assessment.run",
        json!({ "swarm": "rtd", "depth": "quick" }),
    )
    .await;
    let (ack, started, completed, _) =
        await_run_completion(&mut ws, "cmd_run_file_persistence_indexed").await;
    assert_eq!(ack["ok"], true);

    let run_id = started["payload"]["run_id"].as_str().unwrap().to_string();
    assert_eq!(completed["payload"]["run_id"], json!(run_id));

    let persisted = harness
        .persistence
        .load_events(&session_id, 0)
        .expect("load persisted events");
    assert!(
        persisted
            .iter()
            .any(|event| event.event_type == "assessment.started"),
        "canonical JSONL log must contain the run start event"
    );
    assert!(
        persisted
            .iter()
            .any(|event| event.event_type == "assessment.completed"),
        "canonical JSONL log must contain the run completion event"
    );

    let index = harness.index.as_ref().expect("index attached");
    let row = index
        .get_run(&run_id)
        .expect("query run row")
        .expect("run row present in sqlite index");
    assert_eq!(row.run_id, run_id);
    assert_eq!(row.status, "completed");

    send_command(
        &mut ws,
        "cmd_list_runs_file_persistence_indexed",
        &session_id,
        "assessment.list_runs",
        json!({ "limit": 50 }),
    )
    .await;
    let (ack, events) = await_query_event(
        &mut ws,
        "cmd_list_runs_file_persistence_indexed",
        &["assessment.runs_listed"],
    )
    .await;
    assert_eq!(ack["ok"], true);
    let payload = &events[0]["payload"];
    assert_eq!(payload["query_source"], json!("index"));
    assert_eq!(payload["fallback_reason"], Value::Null);
    assert_eq!(payload["source"], json!("index"));
    assert_eq!(payload["index_complete"], json!(true));
    assert_eq!(payload["runs"][0]["id"], json!(run_id));
    assert_eq!(payload["runs"][0]["query_source"], json!("index"));

    send_command(
        &mut ws,
        "cmd_fetch_report_file_persistence_indexed",
        &session_id,
        "assessment.fetch_report",
        json!({ "run_id": run_id }),
    )
    .await;
    let (ack, events) = await_query_event(
        &mut ws,
        "cmd_fetch_report_file_persistence_indexed",
        &["assessment.report_fetched"],
    )
    .await;
    assert_eq!(ack["ok"], true);
    let payload = &events[0]["payload"];
    assert_eq!(payload["query_source"], json!("event_log"));
    assert_eq!(payload["fallback_reason"], json!("index_incomplete"));
    assert_eq!(payload["run"]["query_source"], json!("event_log"));

    send_command(
        &mut ws,
        "cmd_replay_file_persistence_indexed",
        &session_id,
        "assessment.replay",
        json!({ "run_id": run_id }),
    )
    .await;
    let (ack, events) = await_query_event(
        &mut ws,
        "cmd_replay_file_persistence_indexed",
        &["assessment.replayed", "assessment.report_fetched"],
    )
    .await;
    assert_eq!(ack["ok"], true);
    assert_eq!(events[0]["payload"]["query_source"], json!("event_log"));
    assert_eq!(
        events[0]["payload"]["fallback_reason"],
        json!("index_incomplete")
    );
    assert_eq!(events[1]["payload"]["query_source"], json!("event_log"));
    assert_eq!(
        events[1]["payload"]["fallback_reason"],
        json!("index_incomplete")
    );
}
