//! `topbar_interaction` driver — measures latency from a topbar UI action to
//! the resulting state change visible in the cockpit shell.
//!
//! Phase 2 stub. Real implementation must:
//! 1. Drive the cockpit (headless via Playwright or equivalent harness).
//! 2. Trigger N topbar actions (open menu, switch tab, etc.).
//! 3. Measure click-to-paint latency.
//! 4. Compute p50/p95/p99 and emit a `Measurement`.
//!
//! Budget: `topbar_interaction_p95_ms = 100` (config/slo-budgets.yaml).

use crate::Measurement;

#[allow(dead_code)]
pub fn measure() -> anyhow::Result<Measurement> {
    // TODO(phase-2): replace with real driver (see module-level docs).
    anyhow::bail!("topbar_interaction real driver not implemented (Phase 2)")
}
