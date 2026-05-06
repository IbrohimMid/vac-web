//! `command_manifest_refresh` driver — measures latency to fetch and apply an
//! updated command manifest from the bridge.
//!
//! Phase 2 stub. Real implementation must:
//! 1. Mutate the source manifest (bump version, add/remove commands).
//! 2. Trigger refresh from N web clients.
//! 3. Measure refresh request -> applied state on the client.
//! 4. Compute p50/p95/p99 and emit a `Measurement`.
//!
//! Budget: `command_manifest_refresh_p95_ms = 250` (config/slo-budgets.yaml).

use crate::Measurement;

#[allow(dead_code)]
pub fn measure() -> anyhow::Result<Measurement> {
    // TODO(phase-2): replace with real driver (see module-level docs).
    anyhow::bail!("command_manifest_refresh real driver not implemented (Phase 2)")
}
