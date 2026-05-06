//! `persisted_event_write` driver — measures latency for events to be durably
//! written to local-bridge storage (sqlite or equivalent).
//!
//! Phase 2 stub. Real implementation must:
//! 1. Configure local-bridge with a temp storage backend.
//! 2. Issue N events that require persistence.
//! 3. Measure latency from event-emit to fsync ack.
//! 4. Compute p50/p95/p99 and emit a `Measurement`.
//!
//! Budget: `persisted_event_write_p95_ms = 100` (config/slo-budgets.yaml).

use crate::Measurement;

#[allow(dead_code)]
pub fn measure() -> anyhow::Result<Measurement> {
    // TODO(phase-2): replace with real driver (see module-level docs).
    anyhow::bail!("persisted_event_write real driver not implemented (Phase 2)")
}
