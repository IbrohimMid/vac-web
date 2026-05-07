//! `persisted_event_write` driver — measures latency for events to be
//! durably appended to the bridge's session-history JSONL store.
//!
//! Approach:
//! 1. Open a [`FilePersistence`] rooted at a fresh tempdir.
//! 2. Persist a single synthetic [`PersistedSessionMeta`] row.
//! 3. Append `SAMPLE_COUNT` realistic [`PersistedServerEvent`] entries,
//!    timing each [`SessionPersistence::append_event`] call individually.
//! 4. Sort the per-call latencies and emit p50/p95/p99 in milliseconds.
//!
//! The driver intentionally exercises the same write path the bridge
//! uses on its hot path (`BufWriter` open + `serde_json` + `flush`) so the
//! numbers reflect the real cost the cockpit pays during a session. It
//! does NOT call `fsync`, matching the bridge's current durability model;
//! a future tightening of that model should update this driver and the
//! SLO budget together.
//!
//! Budget: `persisted_event_write_p95_ms = 100` (config/slo-budgets.yaml).

use std::path::PathBuf;
use std::time::Instant;

use chrono::Utc;
use local_bridge::session::persistence::{
    FilePersistence, PersistedServerEvent, PersistedSessionMeta, PersistedSessionStatus,
    PersistenceNativeResume, PersistenceVersion, SessionPersistence,
};
use tempfile::TempDir;

use crate::Measurement;

/// Number of `append_event` calls timed per run. 1 000 keeps the driver
/// fast (well under one second on a laptop SSD) while still producing a
/// meaningful p99.
pub const SAMPLE_COUNT: u64 = 1_000;

const SUBSYSTEM: &str = "persisted_event_write";
const SESSION_ID: &str = "perf_session_persisted_event_write";

pub fn measure() -> anyhow::Result<Measurement> {
    let tmp = TempDir::new()?;
    let store = FilePersistence::open(tmp.path())?;

    let now = Utc::now();
    let meta = PersistedSessionMeta {
        version: PersistenceVersion::default(),
        vac_session_id: SESSION_ID.to_string(),
        agent_session_id: None,
        agent_id: "perf-harness".to_string(),
        agent_kind: "perf".to_string(),
        project_root: PathBuf::from("/tmp/perf-harness"),
        profile_id: "perf".to_string(),
        workflow_id: None,
        created_at: now,
        updated_at: now,
        status: PersistedSessionStatus::Active,
        native_resume: PersistenceNativeResume::default(),
        mcp_servers: Vec::new(),
        agent_capabilities: serde_json::Value::Null,
        profile_class: None,
    };
    store.save_meta(&meta)?;

    let mut samples_ns: Vec<u128> = Vec::with_capacity(SAMPLE_COUNT as usize);
    for seq in 0..SAMPLE_COUNT {
        let event = PersistedServerEvent {
            seq,
            event_type: "transcript.delta".to_string(),
            payload: serde_json::json!({
                "text": "perf-harness payload",
                "seq": seq,
            }),
            ts: Utc::now(),
            redaction: Default::default(),
        };
        let started = Instant::now();
        store.append_event(SESSION_ID, &event)?;
        samples_ns.push(started.elapsed().as_nanos());
    }

    Ok(summarize(SUBSYSTEM, samples_ns))
}

fn summarize(subsystem: &str, mut samples_ns: Vec<u128>) -> Measurement {
    samples_ns.sort_unstable();
    let n = samples_ns.len();
    Measurement {
        subsystem: subsystem.to_string(),
        p50_ms: percentile_ms(&samples_ns, 0.50),
        p95_ms: percentile_ms(&samples_ns, 0.95),
        p99_ms: percentile_ms(&samples_ns, 0.99),
        sample_count: n as u64,
    }
}

/// Nearest-rank percentile, in milliseconds. `samples_ns` must already
/// be sorted ascending. Returns `0.0` for an empty input so the report
/// stays well-formed.
fn percentile_ms(samples_ns: &[u128], q: f64) -> f64 {
    if samples_ns.is_empty() {
        return 0.0;
    }
    let n = samples_ns.len();
    let mut idx = (q * n as f64).ceil() as usize;
    if idx == 0 {
        idx = 1;
    }
    if idx > n {
        idx = n;
    }
    samples_ns[idx - 1] as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_ms_handles_empty_and_single_sample() {
        assert_eq!(percentile_ms(&[], 0.5), 0.0);
        assert!((percentile_ms(&[2_000_000], 0.99) - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn percentile_ms_uses_nearest_rank() {
        // 1ms, 2ms, 3ms, 4ms, 5ms
        let samples: Vec<u128> = (1..=5).map(|i| i * 1_000_000).collect();
        assert!((percentile_ms(&samples, 0.50) - 3.0).abs() < f64::EPSILON);
        assert!((percentile_ms(&samples, 0.95) - 5.0).abs() < f64::EPSILON);
        assert!((percentile_ms(&samples, 0.99) - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn measure_returns_well_formed_measurement() {
        let m = measure().expect("measure should succeed on a tempdir");
        assert_eq!(m.subsystem, SUBSYSTEM);
        assert_eq!(m.sample_count, SAMPLE_COUNT);
        assert!(m.p50_ms >= 0.0);
        assert!(m.p95_ms >= m.p50_ms);
        assert!(m.p99_ms >= m.p95_ms);
    }
}
