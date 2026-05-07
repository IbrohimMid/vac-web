//! `command_ack` driver — measures the bridge's per-command dispatch
//! latency for a representative no-op command (`system.ping`).
//!
//! Approach:
//! 1. Build a minimal in-process [`AppState`] that mirrors the
//!    integration-test pattern (no real session registry use, no
//!    persistence, no assessment index). The mock-engine binary path
//!    on [`SessionRegistry`] is never invoked because `system.ping`
//!    is sessionless and resolves before any session lookup.
//! 2. Drive `dispatch_command` directly with a synthetic `system.ping`
//!    `ClientCommand`, timing each call individually. The first call
//!    is treated as a warm-up so the profile-layer cache and any one
//!    -shot allocations don't skew the percentiles.
//! 3. Hand the per-call latencies to [`super::summarize`] for
//!    p50/p95/p99.
//!
//! What this measurement covers:
//!  - Profile-layer enforcement (`enforce_action`).
//!  - Catalog status lookup + match dispatch in `dispatch_command`.
//!  - `ServerAck` construction.
//!
//! What it does NOT cover (intentional, captured by F2.4):
//!  - WebSocket frame parse / encode.
//!  - Network roundtrip.
//!  - Per-connection bookkeeping in the `ws` layer.
//!
//! Budget: `command_ack_p95_ms = 250` (config/slo-budgets.yaml).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use local_bridge::audit::AuditFacility;
use local_bridge::auth::{AuthState, PairingStore};
use local_bridge::config::{ConfigSnapshot, SessionResumePolicy};
use local_bridge::handoff::HandoffService;
use local_bridge::server::AppState;
use local_bridge::session::persistence::PersistenceHealth;
use local_bridge::session::SessionRegistry;
use local_bridge::translator::dispatch_command;
use local_bridge::ws::envelope::ClientCommand;
use serde_json::json;
use tempfile::TempDir;
use tokio::runtime::Builder as RuntimeBuilder;
use tokio::sync::RwLock;

use super::{summarize, Measurement};

/// Number of `system.ping` dispatches timed per run. 1 000 keeps the
/// driver fast (well under one second) while still producing a
/// meaningful p99 for the dispatch hot path.
pub const SAMPLE_COUNT: u64 = 1_000;

const SUBSYSTEM: &str = "command_ack";
const SESSION_ID: &str = "perf_session_command_ack";

pub fn measure() -> anyhow::Result<Measurement> {
    let runtime = RuntimeBuilder::new_current_thread().enable_all().build()?;
    runtime.block_on(measure_async())
}

async fn measure_async() -> anyhow::Result<Measurement> {
    let audit_dir = TempDir::new()?;
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    // tools/perf -> repo root is two parents up; the integration tests
    // resolve the same fixture dir via apps/local-bridge/../../packages.
    let profile_root = PathBuf::from(manifest_dir).join("../../packages/protocol/v1/profiles");
    // Never invoked for `system.ping` (sessionless) but the registry
    // requires a path on construction.
    let unused_engine_bin = PathBuf::from("/dev/null/perf-harness-mock-engine-not-invoked");

    let state = Arc::new(AppState {
        started_at: Instant::now(),
        sessions: SessionRegistry::new(unused_engine_bin),
        auth: AuthState::new_dev(),
        audit: Arc::new(AuditFacility::new(audit_dir.path().to_path_buf())),
        pairing: PairingStore::new(),
        profile_root,
        handoff: Arc::new(HandoffService::new()),
        persistence: None,
        persistence_health: PersistenceHealth::default(),
        assessment_index: None,
        resume_policy: Arc::new(SessionResumePolicy::default()),
        config_snapshot: Arc::new(RwLock::new(ConfigSnapshot::default())),
    });

    // Warm-up dispatch — first call may pay one-shot costs (profile
    // YAML load, allocator warm-up). Drop the result so it doesn't
    // skew percentiles.
    let (warm_ack, _) = dispatch_command(make_ping(0), state.clone()).await;
    if !warm_ack.ok {
        anyhow::bail!(
            "warm-up system.ping returned ok=false: {:?}",
            warm_ack.error
        );
    }

    let mut samples_ns: Vec<u128> = Vec::with_capacity(SAMPLE_COUNT as usize);
    for i in 0..SAMPLE_COUNT {
        let cmd = make_ping(i + 1);
        let started = Instant::now();
        let (ack, _events) = dispatch_command(cmd, state.clone()).await;
        let elapsed = started.elapsed().as_nanos();
        if !ack.ok {
            anyhow::bail!("system.ping returned ok=false at iter {i}: {:?}", ack.error);
        }
        samples_ns.push(elapsed);
    }

    Ok(summarize(SUBSYSTEM, samples_ns))
}

fn make_ping(idx: u64) -> ClientCommand {
    ClientCommand {
        id: format!("perf-ping-{idx}"),
        session_id: SESSION_ID.to_string(),
        cmd_type: "system.ping".to_string(),
        payload: json!({}),
        v: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measure_returns_well_formed_measurement() {
        let m = measure().expect("measure should succeed for system.ping dispatch");
        assert_eq!(m.subsystem, SUBSYSTEM);
        assert_eq!(m.sample_count, SAMPLE_COUNT);
        assert!(m.p50_ms >= 0.0);
        assert!(m.p95_ms >= m.p50_ms);
        assert!(m.p99_ms >= m.p95_ms);
    }
}
