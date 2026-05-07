//! Phase 2 perf scenarios — real per-subsystem drivers.
//!
//! Each submodule implements one driver that produces a `Measurement` for the
//! corresponding subsystem listed in `config/slo-budgets.yaml`. Drivers are
//! gated behind the `real_scenarios` Cargo feature so Phase 1 synthetic
//! measurements remain the default in CI until Phase 2 lands incrementally.
//!
//! Drivers ship one subsystem at a time. The [`try_measure`] dispatcher
//! returns `Ok(Some(_))` for a subsystem that already has a real driver and
//! `Ok(None)` for a stub still pending. The caller in `main.rs` substitutes
//! the real value when present and otherwise keeps the synthetic placeholder,
//! preserving the JSON contract end-to-end while drivers land incrementally.

pub mod command_ack;
pub mod command_manifest_refresh;
pub mod persisted_event_write;
pub mod topbar_interaction;
pub mod websocket_event_delivery;

use crate::Measurement;

/// Dispatch to the real driver for `subsystem` when one is implemented.
///
/// - `Ok(Some(measurement))` — real driver produced a measurement.
/// - `Ok(None)` — driver is still a stub; caller should keep the
///   synthetic placeholder for this subsystem.
/// - `Err(_)` — driver attempted a real run but failed; propagated so
///   the harness fails loud rather than silently swapping back to
///   synthetic.
pub fn try_measure(subsystem: &str) -> anyhow::Result<Option<Measurement>> {
    match subsystem {
        "persisted_event_write" => Ok(Some(persisted_event_write::measure()?)),
        // Other drivers still ship as stubs; fall back to synthetic.
        _ => Ok(None),
    }
}
