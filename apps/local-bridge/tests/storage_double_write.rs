//! Phase N1 integration: end-to-end double-write of assessment events through
//! [`PersistenceSink::record`] into the SQLite [`AssessmentIndex`].
//!
//! These tests exercise the wired sink (JSONL append + index mirror) without
//! standing up the full WS server — they construct a [`PersistenceSink`]
//! directly with a [`FilePersistence`] backing store and an in-memory
//! [`AssessmentIndex`], then drive `record(...)` with hand-crafted
//! [`ServerEvent`]s.
//!
//! Contract under test (see N1 in the implementation plan):
//! 1. assessment.started double-writes a row into the index.
//! 2. Non-assessment events are NOT mirrored.
//! 3. Malformed assessment payloads (missing run_id) are non-fatal: the sink
//!    must not panic, the JSONL append must still happen, and
//!    [`PersistenceHealth::is_degraded`] must remain false (Malformed is a
//!    soft skip, not an error).
//!
//! Runtime failure of the index itself (e.g. read-only disk, corrupted file)
//! is unit-tested at the writer layer; here we focus on the sink wiring so
//! that future refactors of the spawn path keep the contract intact.

use std::sync::Arc;

use local_bridge::session::persistence::{
    FilePersistence, PersistenceHealth, PersistenceSink, RedactionMode,
};
use local_bridge::storage::AssessmentIndex;
use local_bridge::ws::ServerEvent;
use serde_json::json;
use tempfile::TempDir;

use local_bridge::session::persistence::{
    PersistedSessionMeta, PersistedSessionStatus, PersistenceNativeResume, PersistenceVersion,
    SessionPersistence,
};

fn make_event(event_type: &str, payload: serde_json::Value) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: "vac-session-test".to_string(),
        event_type: event_type.to_string(),
        payload,
        v: 1,
        ts: "2026-04-30T20:33:00Z".to_string(),
    }
}

fn make_sink(
    tmp: &TempDir,
    index: Option<Arc<AssessmentIndex>>,
) -> (PersistenceSink, PersistenceHealth) {
    let persistence = Arc::new(FilePersistence::open(tmp.path()).expect("open FilePersistence"));
    // The session row must exist before the sink can append events; the WS
    // create path normally calls `save_meta` right before the first event,
    // so we mirror that contract here.
    let now = chrono::Utc::now();
    persistence
        .save_meta(&PersistedSessionMeta {
            version: PersistenceVersion::default(),
            vac_session_id: "vac-session-test".to_string(),
            agent_session_id: None,
            agent_id: "acp".to_string(),
            agent_kind: "acp".to_string(),
            project_root: tmp.path().to_path_buf(),
            profile_id: "default".to_string(),
            workflow_id: None,
            created_at: now,
            updated_at: now,
            status: PersistedSessionStatus::Active,
            native_resume: PersistenceNativeResume::default(),
            mcp_servers: Vec::new(),
            agent_capabilities: serde_json::Value::Null,
            profile_class: None,
        })
        .expect("save_meta");
    let health = PersistenceHealth::new();
    let sink = PersistenceSink::with_health(
        persistence,
        "vac-session-test".to_string(),
        RedactionMode::Standard,
        health.clone(),
        None,
    )
    .with_assessment_index(index);
    (sink, health)
}

#[test]
fn assessment_started_double_writes_to_index() {
    let tmp = TempDir::new().expect("tempdir");
    let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
    let (sink, health) = make_sink(&tmp, Some(Arc::clone(&index)));

    let event = make_event(
        "assessment.started",
        json!({
            "run_id": "run-001",
            "vac_session_id": "vac-session-test",
            "swarm": "rtd",
            "started_at": "2026-04-30T20:33:00Z",
        }),
    );
    sink.record(&event);

    let row = index
        .get_run("run-001")
        .expect("query")
        .expect("row present");
    assert_eq!(row.run_id, "run-001");
    assert_eq!(row.session_id, "vac-session-test");
    assert_eq!(row.swarm, "rtd");
    assert_eq!(row.status, "running");
    assert!(
        !health.is_degraded(),
        "successful double-write must not degrade persistence health"
    );
}

#[test]
fn non_assessment_event_is_not_mirrored() {
    let tmp = TempDir::new().expect("tempdir");
    let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
    let (sink, health) = make_sink(&tmp, Some(Arc::clone(&index)));

    let event = make_event("session.message_submit", json!({ "text": "hello world" }));
    sink.record(&event);

    let runs = index
        .list_runs(None, None, 10)
        .expect("list_runs returns Ok");
    assert!(
        runs.is_empty(),
        "non-assessment events must not produce index rows; got {:?}",
        runs.iter().map(|r| &r.run_id).collect::<Vec<_>>()
    );
    assert!(
        !health.is_degraded(),
        "a non-mirrored event must not flip the degraded flag"
    );
}

#[test]
fn malformed_assessment_payload_is_non_fatal() {
    let tmp = TempDir::new().expect("tempdir");
    let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
    let (sink, health) = make_sink(&tmp, Some(Arc::clone(&index)));

    // assessment.started with no `run_id` triggers WriteOutcome::Malformed in
    // the writer. The sink must NOT panic, the JSONL append must still
    // happen, and the health flag must remain clean (Malformed is a soft
    // skip, not a SQLite-level failure).
    let event = make_event(
        "assessment.started",
        json!({
            "vac_session_id": "vac-session-test",
            "swarm": "rtd",
        }),
    );
    sink.record(&event);

    let runs = index
        .list_runs(None, None, 10)
        .expect("list_runs returns Ok");
    assert!(
        runs.is_empty(),
        "malformed payload must not produce a partial index row"
    );
    assert!(
        !health.is_degraded(),
        "malformed payload is a soft skip, not a degraded-health condition"
    );
}

#[test]
fn sink_without_index_handle_skips_double_write_silently() {
    // Regression guard: when the bridge boots without an AssessmentIndex
    // (open() failed at startup, or feature disabled), the sink must still
    // accept assessment events and persist them to JSONL without any
    // mirroring side-effect or health-flag flip.
    let tmp = TempDir::new().expect("tempdir");
    let (sink, health) = make_sink(&tmp, None);

    sink.record(&make_event(
        "assessment.started",
        json!({ "run_id": "run-noop" }),
    ));

    assert!(
        !health.is_degraded(),
        "absence of an index handle must not be treated as a failure"
    );
}
