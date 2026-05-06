//! `command_ack` driver — measures latency from command issue to ack receipt.
//!
//! Phase 2 stub. Real implementation must:
//! 1. Connect to local-bridge over loopback socket.
//! 2. Send N commands (N >= 1000).
//! 3. Record per-command ack latency.
//! 4. Compute p50/p95/p99 and emit a `Measurement`.
//!
//! Budget: `command_ack_p95_ms = 250` (config/slo-budgets.yaml).

use crate::Measurement;

#[allow(dead_code)]
pub fn measure() -> anyhow::Result<Measurement> {
    // TODO(phase-2): replace with real driver (see module-level docs).
    anyhow::bail!("command_ack real driver not implemented (Phase 2)")
}
