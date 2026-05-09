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
//!
//! Shared helpers ([`summarize`] / [`percentile_ms`]) live here so each
//! driver can keep its file focused on the real measurement loop.

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
        "command_manifest_refresh" => Ok(Some(command_manifest_refresh::measure()?)),
        "command_ack" => Ok(Some(command_ack::measure()?)),
        "websocket_event_delivery" => Ok(Some(websocket_event_delivery::measure()?)),
        "topbar_interaction" => Ok(Some(topbar_interaction::measure()?)),
        // All Phase 2 drivers ship real now; unknown subsystems still fall
        // back to synthetic so a new SLO entry can land before its driver.
        _ => Ok(None),
    }
}

/// Build a [`Measurement`] from a vector of per-call latencies in
/// nanoseconds. Sorts in place and emits p50/p95/p99 in milliseconds via
/// [`percentile_ms`]. Shared across drivers so per-driver code stays
/// focused on the real measurement loop.
pub(crate) fn summarize(subsystem: &str, mut samples_ns: Vec<u128>) -> Measurement {
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
pub(crate) fn percentile_ms(samples_ns: &[u128], q: f64) -> f64 {
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
    fn summarize_sorts_input_and_returns_percentiles() {
        // Intentionally unsorted; summarize() must sort internally.
        let samples = vec![5_000_000u128, 1_000_000, 3_000_000, 2_000_000, 4_000_000];
        let m = summarize("test", samples);
        assert_eq!(m.subsystem, "test");
        assert_eq!(m.sample_count, 5);
        assert!((m.p50_ms - 3.0).abs() < f64::EPSILON);
        assert!((m.p95_ms - 5.0).abs() < f64::EPSILON);
        assert!((m.p99_ms - 5.0).abs() < f64::EPSILON);
    }
}
