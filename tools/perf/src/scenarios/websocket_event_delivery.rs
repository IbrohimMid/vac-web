//! `websocket_event_delivery` driver — measures latency from event publish to
//! WebSocket frame delivery to the web client.
//!
//! Phase 2 stub. Real implementation must:
//! 1. Open a WebSocket connection to local-bridge.
//! 2. Trigger N publishable events server-side.
//! 3. Measure publish-time -> frame-arrival-time on the client.
//! 4. Compute p50/p95/p99 and emit a `Measurement`.
//!
//! Budget: `websocket_event_delivery_p95_ms = 250` (config/slo-budgets.yaml).

use crate::Measurement;

#[allow(dead_code)]
pub fn measure() -> anyhow::Result<Measurement> {
    // TODO(phase-2): replace with real driver (see module-level docs).
    anyhow::bail!("websocket_event_delivery real driver not implemented (Phase 2)")
}
