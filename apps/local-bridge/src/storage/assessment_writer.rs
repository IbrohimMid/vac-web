//! Translate persisted assessment.* `ServerEvent`s into
//! [`AssessmentIndex`] row writes.
//!
//! Wired into the bridge by Phase N1: every event that flows through
//! [`crate::session::persistence::PersistenceSink::record`] is double-written
//! to a SQLite cache index when this module recognises it as an assessment
//! event. JSONL on disk remains the canonical source of truth; the index is
//! a derived acceleration only.
//!
//! Failure semantics (enforced by the caller in `sink.rs`):
//! - The JSONL append happens *before* the index write. An index write that
//!   fails MUST NOT fail the surrounding `record(...)` call — the live
//!   session must keep emitting events even if the index goes read-only or
//!   is corrupted.
//! - Failures are surfaced via [`crate::session::persistence::PersistenceHealth`]
//!   under the new `"index_write_failed"` reason. We deliberately do *not*
//!   emit a per-failure ServerEvent; the existing `session.persistence_degraded`
//!   broadcast already covers that, and adding a second event type would be
//!   noisy on a flapping disk.

use serde_json::Value;

use super::assessment_index::{
    AssessmentFindingRow, AssessmentIndexStore, AssessmentRunRow, AssessmentSweepRow, Result,
};
use crate::session::persistence::PersistedServerEvent;

/// Result of a double-write attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Event was not an assessment event we mirror; nothing was written.
    NotMirrored,
    /// Event was mirrored — at least one row was upserted.
    Mirrored,
    /// Event was an assessment event we mirror, but its payload was missing
    /// the required identifiers (e.g. `run_id`). Counts as a soft skip; the
    /// caller may surface a degraded-health note but should not treat it
    /// as a hard failure.
    Malformed,
}

/// Allowlist of event types this writer mirrors into the SQLite index. Kept
/// in one place so callers (and tests) can enumerate the contract without
/// reaching into the dispatcher.
pub const MIRRORED_EVENT_TYPES: &[&str] = &[
    "assessment.started",
    "assessment.progress",
    "assessment.candidate_received",
    "assessment.candidate_rejected",
    "assessment.evidence_attached",
    "assessment.finding_added",
    "assessment.completed",
    "assessment.failed",
    "assessment.sweep.started",
    "assessment.sweep.progress",
    "assessment.sweep.completed",
    "assessment.sweep.failed",
];

/// Returns `true` when this writer mirrors `event_type` to the SQLite index.
pub fn is_mirrored(event_type: &str) -> bool {
    MIRRORED_EVENT_TYPES.contains(&event_type)
}

/// Apply a single persisted event to the index. Returns:
/// - `Ok(NotMirrored)` if `event` is not an assessment event we mirror.
/// - `Ok(Mirrored)` on a successful upsert.
/// - `Ok(Malformed)` if the payload is missing required fields.
/// - `Err(...)` only on a real SQLite-level failure (lock poisoned, disk
///   error, schema mismatch). The caller is responsible for converting
///   `Err` into a degraded-health note without failing the JSONL write.
pub fn record_event(
    index: &impl AssessmentIndexStore,
    event: &PersistedServerEvent,
) -> Result<WriteOutcome> {
    if !is_mirrored(&event.event_type) {
        return Ok(WriteOutcome::NotMirrored);
    }
    let payload = &event.payload;
    let ts = event.ts.to_rfc3339();

    match event.event_type.as_str() {
        "assessment.started" => write_run_started(index, payload, &ts),
        "assessment.completed" => write_run_terminal(index, payload, &ts, "completed"),
        "assessment.failed" => write_run_terminal(index, payload, &ts, "failed"),
        "assessment.progress"
        | "assessment.candidate_received"
        | "assessment.candidate_rejected"
        | "assessment.evidence_attached" => write_run_progress(index, payload, &ts),
        "assessment.finding_added" => write_finding(index, payload, &ts),
        "assessment.sweep.started" => write_sweep_started(index, payload, &ts),
        "assessment.sweep.completed" => write_sweep_terminal(index, payload, &ts, "completed"),
        "assessment.sweep.failed" => write_sweep_terminal(index, payload, &ts, "failed"),
        "assessment.sweep.progress" => write_sweep_progress(index, payload, &ts),
        _ => Ok(WriteOutcome::NotMirrored),
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(*key).and_then(Value::as_str) {
            return Some(found.to_string());
        }
    }
    None
}

fn session_id(payload: &Value) -> String {
    string_field(payload, &["vac_session_id", "session_id", "sessionId"])
        .unwrap_or_else(|| "unknown".to_string())
}

fn write_run_started(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
) -> Result<WriteOutcome> {
    let Some(run_id) = string_field(payload, &["run_id", "runId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let swarm = string_field(payload, &["swarm"]).unwrap_or_else(|| "rtd".to_string());
    let started_at =
        string_field(payload, &["started_at", "startedAt"]).unwrap_or_else(|| ts.to_string());
    let row = AssessmentRunRow {
        run_id,
        session_id: session_id(payload),
        swarm,
        status: "running".into(),
        started_at,
        completed_at: None,
        verdict: None,
        payload_json: payload.to_string(),
    };
    index.record_run(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_run_terminal(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
    fallback_status: &str,
) -> Result<WriteOutcome> {
    let Some(run_id) = string_field(payload, &["run_id", "runId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let status = string_field(payload, &["status"]).unwrap_or_else(|| fallback_status.to_string());
    let verdict = string_field(payload, &["verdict"]);
    // Preserve started_at/swarm/session_id from the existing row if present.
    let existing = index.get_run(&run_id)?;
    let (session_id_v, swarm, started_at) = match existing {
        Some(row) => (row.session_id, row.swarm, row.started_at),
        None => (
            session_id(payload),
            string_field(payload, &["swarm"]).unwrap_or_else(|| "rtd".to_string()),
            string_field(payload, &["started_at", "startedAt"]).unwrap_or_else(|| ts.to_string()),
        ),
    };
    let row = AssessmentRunRow {
        run_id,
        session_id: session_id_v,
        swarm,
        status,
        started_at,
        completed_at: Some(ts.to_string()),
        verdict,
        payload_json: payload.to_string(),
    };
    index.record_run(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_run_progress(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
) -> Result<WriteOutcome> {
    let Some(run_id) = string_field(payload, &["run_id", "runId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let existing = index.get_run(&run_id)?;
    let row = match existing {
        Some(mut row) => {
            // Preserve status / started_at / verdict / completed_at — progress events
            // must not undo a terminal state recorded by an out-of-order completed/failed.
            row.payload_json = payload.to_string();
            row
        }
        None => AssessmentRunRow {
            run_id,
            session_id: session_id(payload),
            swarm: string_field(payload, &["swarm"]).unwrap_or_else(|| "rtd".to_string()),
            status: "running".into(),
            started_at: string_field(payload, &["started_at", "startedAt"])
                .unwrap_or_else(|| ts.to_string()),
            completed_at: None,
            verdict: None,
            payload_json: payload.to_string(),
        },
    };
    index.record_run(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_finding(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
) -> Result<WriteOutcome> {
    let Some(run_id) = string_field(payload, &["run_id", "runId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let Some(finding_id) = string_field(payload, &["finding_id", "findingId", "id"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    // identity_hash defaults to finding_id when absent so the row stays
    // queryable; the diff path can still join on identity_hash later.
    let identity_hash = string_field(payload, &["identity_hash", "identityHash"])
        .unwrap_or_else(|| finding_id.clone());
    let severity = string_field(payload, &["severity"]).unwrap_or_else(|| "info".to_string());
    let category =
        string_field(payload, &["category", "family"]).unwrap_or_else(|| "unknown".to_string());
    let emitted_at =
        string_field(payload, &["emitted_at", "emittedAt", "ts"]).unwrap_or_else(|| ts.to_string());

    // Ensure the parent run row exists so the FK + downstream `list_findings`
    // queries work even when finding_added arrives before the started event
    // is replayed (a real possibility on legacy logs).
    if index.get_run(&run_id)?.is_none() {
        let parent = AssessmentRunRow {
            run_id: run_id.clone(),
            session_id: session_id(payload),
            swarm: "rtd".into(),
            status: "running".into(),
            started_at: emitted_at.clone(),
            completed_at: None,
            verdict: None,
            payload_json: "{}".into(),
        };
        index.record_run(&parent)?;
    }

    let row = AssessmentFindingRow {
        finding_id,
        run_id,
        identity_hash,
        severity,
        category,
        emitted_at,
        payload_json: payload.to_string(),
    };
    index.record_finding(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_sweep_started(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
) -> Result<WriteOutcome> {
    let Some(sweep_id) = string_field(payload, &["sweep_id", "sweepId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let started_at =
        string_field(payload, &["started_at", "startedAt"]).unwrap_or_else(|| ts.to_string());
    let families_csv = payload
        .get("families")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    let row = AssessmentSweepRow {
        sweep_id,
        session_id: session_id(payload),
        status: "running".into(),
        started_at,
        completed_at: None,
        families_csv,
        payload_json: payload.to_string(),
    };
    index.record_sweep(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_sweep_terminal(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
    fallback_status: &str,
) -> Result<WriteOutcome> {
    let Some(sweep_id) = string_field(payload, &["sweep_id", "sweepId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let status = string_field(payload, &["status"]).unwrap_or_else(|| fallback_status.to_string());
    let existing = index.get_sweep(&sweep_id)?;
    let (session_id_v, started_at, families_csv) = match existing {
        Some(row) => (row.session_id, row.started_at, row.families_csv),
        None => (
            session_id(payload),
            string_field(payload, &["started_at", "startedAt"]).unwrap_or_else(|| ts.to_string()),
            payload
                .get("families")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default(),
        ),
    };
    let row = AssessmentSweepRow {
        sweep_id,
        session_id: session_id_v,
        status,
        started_at,
        completed_at: Some(ts.to_string()),
        families_csv,
        payload_json: payload.to_string(),
    };
    index.record_sweep(&row)?;
    Ok(WriteOutcome::Mirrored)
}

fn write_sweep_progress(
    index: &impl AssessmentIndexStore,
    payload: &Value,
    ts: &str,
) -> Result<WriteOutcome> {
    let Some(sweep_id) = string_field(payload, &["sweep_id", "sweepId"]) else {
        return Ok(WriteOutcome::Malformed);
    };
    let existing = index.get_sweep(&sweep_id)?;
    let row = match existing {
        Some(mut row) => {
            row.payload_json = payload.to_string();
            row
        }
        None => AssessmentSweepRow {
            sweep_id,
            session_id: session_id(payload),
            status: "running".into(),
            started_at: string_field(payload, &["started_at", "startedAt"])
                .unwrap_or_else(|| ts.to_string()),
            completed_at: None,
            families_csv: payload
                .get("families")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default(),
            payload_json: payload.to_string(),
        },
    };
    index.record_sweep(&row)?;
    Ok(WriteOutcome::Mirrored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::persistence::PersistedServerEvent;
    use crate::storage::AssessmentIndex;
    use chrono::{DateTime, Utc};
    use serde_json::json;

    fn ev(seq: u64, ts: &str, ty: &str, payload: serde_json::Value) -> PersistedServerEvent {
        PersistedServerEvent {
            seq,
            event_type: ty.to_string(),
            payload,
            ts: DateTime::parse_from_rfc3339(ts)
                .unwrap()
                .with_timezone(&Utc),
            redaction: Default::default(),
        }
    }

    #[test]
    fn non_assessment_event_is_not_mirrored() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        let outcome = record_event(
            &idx,
            &ev(1, "2026-05-01T00:00:00Z", "session.created", json!({})),
        )
        .unwrap();
        assert_eq!(outcome, WriteOutcome::NotMirrored);
        assert!(idx.list_runs(None, None, 0).unwrap().is_empty());
    }

    #[test]
    fn started_writes_running_run_row() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        let outcome = record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.started",
                json!({
                    "run_id": "run_a",
                    "swarm": "rtd",
                    "started_at": "2026-05-01T00:00:00Z",
                    "vac_session_id": "sess_1",
                }),
            ),
        )
        .unwrap();
        assert_eq!(outcome, WriteOutcome::Mirrored);
        let row = idx.get_run("run_a").unwrap().unwrap();
        assert_eq!(row.status, "running");
        assert_eq!(row.swarm, "rtd");
        assert_eq!(row.session_id, "sess_1");
        assert!(row.completed_at.is_none());
    }

    #[test]
    fn completed_marks_run_terminal_and_preserves_started_at() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.started",
                json!({
                    "run_id": "run_a",
                    "swarm": "rtd",
                    "vac_session_id": "sess_1",
                    "started_at": "2026-05-01T00:00:00Z",
                }),
            ),
        )
        .unwrap();
        record_event(
            &idx,
            &ev(
                2,
                "2026-05-01T00:00:30Z",
                "assessment.completed",
                json!({
                    "run_id": "run_a",
                    "verdict": "warn",
                }),
            ),
        )
        .unwrap();
        let row = idx.get_run("run_a").unwrap().unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.verdict.as_deref(), Some("warn"));
        assert_eq!(
            row.completed_at.as_deref(),
            Some("2026-05-01T00:00:30+00:00")
        );
        assert_eq!(row.started_at, "2026-05-01T00:00:00Z");
    }

    #[test]
    fn progress_does_not_override_terminal_status() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.started",
                json!({"run_id": "run_a", "vac_session_id": "sess_1"}),
            ),
        )
        .unwrap();
        record_event(
            &idx,
            &ev(
                2,
                "2026-05-01T00:00:10Z",
                "assessment.completed",
                json!({"run_id": "run_a", "verdict": "pass"}),
            ),
        )
        .unwrap();
        // A late-arriving progress event must not undo the terminal state.
        record_event(
            &idx,
            &ev(
                3,
                "2026-05-01T00:00:11Z",
                "assessment.progress",
                json!({"run_id": "run_a", "completed": 5, "total": 5}),
            ),
        )
        .unwrap();
        let row = idx.get_run("run_a").unwrap().unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.verdict.as_deref(), Some("pass"));
    }

    #[test]
    fn finding_added_writes_finding_row_and_creates_parent_run() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        // Note: finding arrives BEFORE started — writer must still create parent.
        record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.finding_added",
                json!({
                    "run_id": "run_a",
                    "finding_id": "f1",
                    "identity_hash": "h1",
                    "severity": "high",
                    "category": "technical",
                }),
            ),
        )
        .unwrap();
        let findings = idx.list_findings("run_a").unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, "high");
        assert_eq!(findings[0].identity_hash, "h1");
        assert!(idx.get_run("run_a").unwrap().is_some());
    }

    #[test]
    fn evidence_attached_upserts_run_payload() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        let outcome = record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.evidence_attached",
                json!({"run_id": "run_a", "evidence_id": "e1"}),
            ),
        )
        .unwrap();
        assert_eq!(outcome, WriteOutcome::Mirrored);
        let row = idx.get_run("run_a").unwrap().unwrap();
        assert!(row.payload_json.contains("evidence_id"));
    }

    #[test]
    fn sweep_started_then_completed_roundtrip() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        record_event(
            &idx,
            &ev(
                1,
                "2026-05-01T00:00:00Z",
                "assessment.sweep.started",
                json!({
                    "sweep_id": "sw1",
                    "families": ["rtd", "security"],
                    "vac_session_id": "sess_1",
                }),
            ),
        )
        .unwrap();
        record_event(
            &idx,
            &ev(
                2,
                "2026-05-01T00:01:00Z",
                "assessment.sweep.completed",
                json!({"sweep_id": "sw1", "verdict": "warn"}),
            ),
        )
        .unwrap();
        let row = idx.get_sweep("sw1").unwrap().unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.families_csv, "rtd,security");
        assert!(row.completed_at.is_some());
    }

    #[test]
    fn malformed_payload_returns_malformed_not_error() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        let outcome = record_event(
            &idx,
            &ev(1, "2026-05-01T00:00:00Z", "assessment.started", json!({})),
        )
        .unwrap();
        assert_eq!(outcome, WriteOutcome::Malformed);
        assert!(idx.list_runs(None, None, 0).unwrap().is_empty());
    }

    #[test]
    fn is_mirrored_covers_full_allowlist() {
        for ty in MIRRORED_EVENT_TYPES {
            assert!(is_mirrored(ty), "expected {ty} to be mirrored");
        }
        assert!(!is_mirrored("session.created"));
        assert!(!is_mirrored("assessment.replayed"));
    }
}
