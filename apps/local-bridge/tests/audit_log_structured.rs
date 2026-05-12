//! Slice 41 (continuation #5): integration coverage for the
//! `audit::log_structured` adapter.
//!
//! The unit tests in `observability::tests` already cover the builder's
//! validation surface (event id, namespaced keys, optional-key empty
//! checks), and the accessor tests in the same module verify
//! `severity_for_audit` / `session_id_for_audit` in isolation. What
//! those don't exercise is the *end-to-end* path:
//!
//!   1. Construct a real `AuditFacility` over a tempdir.
//!   2. Fold it into a minimal `AppState` so the adapter signature
//!      `(&AppStateHandle, subsystem, builder)` works against the live
//!      production code path.
//!   3. Call `audit::log_structured` and assert that the validated
//!      JSON value is what lands on disk in the per-session JSONL
//!      shard, with the severity correctly mapped through to
//!      `bridge_core::AuditSeverity`.
//!
//! This test guards against regressions in:
//!   * the `LogSeverity` → `AuditSeverity` mapping in `log_structured`,
//!   * the session-id fallback (`_sessionless` when the builder has no
//!     explicit session),
//!   * and the silent-skip on validation failure (no file is created
//!     for malformed events).

#![allow(clippy::useless_conversion)]

use local_bridge::audit::{self, AuditFacility};
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::config::{ConfigSnapshot, SessionResumePolicy};
use local_bridge::handoff::HandoffService;
use local_bridge::observability::{LogActor, LogSeverity, StructuredLogBuilder};
use local_bridge::server::{AppState, AppStateHandle};
use local_bridge::session::persistence::PersistenceHealth;
use local_bridge::session::SessionRegistry;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;

struct AuditHarness {
    state: AppStateHandle,
    audit_dir: TempDir,
}

fn make_audit_harness() -> AuditHarness {
    let audit_dir = tempfile::tempdir().expect("create audit tempdir");
    let audit = Arc::new(AuditFacility::new(audit_dir.path().to_path_buf()));
    // SessionRegistry::new is the back-compat constructor that just
    // synthesizes an empty agent registry around the supplied engine
    // path. We never spawn a session in this test, so the path can be
    // a placeholder.
    let sessions = SessionRegistry::new(PathBuf::from("/nonexistent-engine-bin"));
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
        persistence_health: PersistenceHealth::new(),
        assessment_index: None,
        resume_policy: Arc::new(SessionResumePolicy::default()),
        config_snapshot: Arc::new(tokio::sync::RwLock::new(ConfigSnapshot::default())),
        release_provider: local_bridge::release::ReleaseProvider::default(),
    });
    AuditHarness { state, audit_dir }
}

/// Read every JSONL file produced under the audit dir and return the
/// parsed entries, sorted by session-id-shard for stable assertions.
async fn read_audit_entries(dir: &std::path::Path) -> Vec<(String, Vec<Value>)> {
    let mut shards: Vec<(String, Vec<Value>)> = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(d) => d,
        Err(_) => return shards,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let content = tokio::fs::read_to_string(&p)
            .await
            .expect("read audit shard");
        let parsed: Vec<Value> = content
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str::<Value>(l).expect("audit line is JSON"))
            .collect();
        let stem = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        shards.push((stem, parsed));
    }
    shards.sort_by(|a, b| a.0.cmp(&b.0));
    shards
}

#[tokio::test]
async fn log_structured_writes_validated_payload_to_audit_shard() {
    let h = make_audit_harness();

    // Use a catalog event id (`session.started`) so the builder's
    // `validate_event_id` rule passes. The test is about the adapter
    // path end-to-end, not catalog membership — but using a real
    // event keeps the test honest about the production wire format.
    let builder = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Info)
        .session_id("sess_audit_it_01")
        .code("ok")
        .latency_ms(7.5);

    audit::log_structured(&h.state, "audit_it", builder)
        .expect("log_structured succeeds for a valid builder");

    // The audit writer flushes asynchronously. Poll until the shard
    // appears (with a generous-but-bounded ceiling so a real
    // regression still fails in CI).
    let path = h.audit_dir.path().join("sess_audit_it_01.jsonl");
    let mut attempts = 0;
    while attempts < 50 && !path.exists() {
        tokio::time::sleep(Duration::from_millis(20)).await;
        attempts += 1;
    }
    assert!(
        path.exists(),
        "expected audit shard at {} after log_structured",
        path.display()
    );

    let shards = read_audit_entries(h.audit_dir.path()).await;
    assert_eq!(
        shards.len(),
        1,
        "exactly one shard expected, got {shards:?}"
    );
    let (shard_name, entries) = &shards[0];
    assert_eq!(shard_name, "sess_audit_it_01");
    assert_eq!(entries.len(), 1, "exactly one audit entry expected");

    let entry = &entries[0];
    // The bridge-core AuditEntry envelope.
    assert_eq!(entry["session_id"], "sess_audit_it_01");
    assert_eq!(entry["subsystem"], "audit_it");
    assert_eq!(entry["severity"], "info");

    // The validated builder payload is nested under `fields`.
    let fields = entry.get("fields").expect("fields present");
    assert_eq!(fields["event"], "session.started");
    assert_eq!(fields["session_id"], "sess_audit_it_01");
    assert_eq!(fields["actor"], "user");
    assert_eq!(fields["severity"], "info");
    assert_eq!(fields["code"], "ok");
    assert_eq!(fields["latency_ms"], 7.5);
}

#[tokio::test]
async fn log_structured_falls_back_to_sessionless_shard_when_no_session_id() {
    let h = make_audit_harness();

    let builder =
        StructuredLogBuilder::new("session.closed", LogActor::System, LogSeverity::Warning);

    audit::log_structured(&h.state, "audit_it", builder).expect("valid builder");

    let path = h.audit_dir.path().join("_sessionless.jsonl");
    let mut attempts = 0;
    while attempts < 50 && !path.exists() {
        tokio::time::sleep(Duration::from_millis(20)).await;
        attempts += 1;
    }
    assert!(
        path.exists(),
        "expected sessionless shard at {} after log_structured with no session",
        path.display()
    );

    let shards = read_audit_entries(h.audit_dir.path()).await;
    assert_eq!(shards.len(), 1, "exactly one shard expected");
    let (shard_name, entries) = &shards[0];
    assert_eq!(shard_name, "_sessionless");
    assert_eq!(entries.len(), 1);

    let entry = &entries[0];
    // Severity::Warning maps to bridge-core AuditSeverity::Warn.
    assert_eq!(entry["severity"], "warn");
    // Envelope session_id mirrors the fallback.
    assert_eq!(entry["session_id"], "_sessionless");
    // The validated payload still records the absence as null per
    // the StructuredLogBuilder contract.
    let fields = entry.get("fields").expect("fields present");
    assert!(
        fields["session_id"].is_null(),
        "expected null session_id in payload; got {fields:?}"
    );
}

#[tokio::test]
async fn log_structured_skips_audit_write_on_validation_failure() {
    let h = make_audit_harness();

    // `Session.Started` has uppercase chars → builder rejects it at
    // `build()` and `log_structured` propagates the error without
    // ever touching the audit writer.
    let builder = StructuredLogBuilder::new("Session.Started", LogActor::User, LogSeverity::Info);

    let err = audit::log_structured(&h.state, "audit_it", builder)
        .expect_err("validation should reject uppercase event id");
    let msg = format!("{err}");
    assert!(
        msg.contains("Session.Started") || msg.to_lowercase().contains("event"),
        "unexpected error message: {msg}"
    );

    // Wait long enough that any (incorrect) async write would have
    // landed before we assert the directory is empty.
    tokio::time::sleep(Duration::from_millis(100)).await;

    let shards = read_audit_entries(h.audit_dir.path()).await;
    assert!(
        shards.is_empty(),
        "validation failure must not produce audit entries; got {shards:?}"
    );
}
