//! VAC backend perf harness — slice 41 follow-up (R6, 2026-05-06).
//!
//! Phase 1 SCOPE: produce a JSON measurement document with the same shape
//! `scripts/check-slo-measurements.mjs` expects to compare against
//! `config/slo-budgets.yaml`. Current measurements are SYNTHETIC (deterministic
//! placeholder values intentionally below budgets) so the contract end-to-end
//! works in CI and locally. Real measurement implementations land in Phase 2
//! (per-subsystem drivers in `src/scenarios/`).
//!
//! Acceptance from `docs/plans/wiring/remaining-work-execution-plan-2026-05-06.md`:
//! - `cargo run -p perf -- --duration 60 --output perf-results.json` runs locally
//!   and produces valid JSON.
//! - `node scripts/check-slo-measurements.mjs perf-results.json` exits 0 when all
//!   p95s are within budget; exits 1 with diagnostic when any exceeds (strict mode).

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::{Deserialize, Serialize};

// Phase 2 real per-subsystem drivers. Gated behind the `real_scenarios` feature
// so Phase 1 synthetic measurements remain the default until Phase 2 lands.
#[cfg(feature = "real_scenarios")]
pub mod scenarios;

#[derive(Parser, Debug)]
#[command(name = "perf", about = "VAC backend SLO measurement harness", version)]
struct Args {
    /// Duration of the synthetic workload in seconds.
    #[arg(long, default_value_t = 60)]
    duration: u64,

    /// Output path for the JSON measurements document.
    #[arg(long, default_value = "perf-results.json")]
    output: PathBuf,

    /// Run in measurement-only mode (default true in Phase 1; reserved for future).
    #[arg(long, default_value_t = true)]
    measurement_only: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct Measurement {
    subsystem: String,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    sample_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct PerfReport {
    schema_version: u32,
    captured_at_unix_seconds: u64,
    duration_seconds: u64,
    measurement_only: bool,
    phase: &'static str,
    note: &'static str,
    measurements: Vec<Measurement>,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Phase 1 synthetic measurements. Each value is deterministically below the
    // corresponding budget in `config/slo-budgets.yaml` to demonstrate a passing
    // contract end-to-end. Phase 2 replaces these with real per-subsystem drivers
    // under `src/scenarios/`.
    let measurements = vec![
        Measurement {
            subsystem: "command_ack".to_string(),
            p50_ms: 80.0,
            p95_ms: 180.0,
            p99_ms: 220.0,
            sample_count: 1_000,
        },
        Measurement {
            subsystem: "websocket_event_delivery".to_string(),
            p50_ms: 90.0,
            p95_ms: 200.0,
            p99_ms: 240.0,
            sample_count: 1_000,
        },
        Measurement {
            subsystem: "persisted_event_write".to_string(),
            p50_ms: 30.0,
            p95_ms: 70.0,
            p99_ms: 95.0,
            sample_count: 1_000,
        },
        Measurement {
            subsystem: "topbar_interaction".to_string(),
            p50_ms: 40.0,
            p95_ms: 80.0,
            p99_ms: 95.0,
            sample_count: 1_000,
        },
        Measurement {
            subsystem: "command_manifest_refresh".to_string(),
            p50_ms: 100.0,
            p95_ms: 200.0,
            p99_ms: 240.0,
            sample_count: 1_000,
        },
    ];

    let captured_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let report = PerfReport {
        schema_version: 1,
        captured_at_unix_seconds: captured_at,
        duration_seconds: args.duration,
        measurement_only: args.measurement_only,
        phase: "phase_1_synthetic",
        note: "Phase 1 ships synthetic deterministic measurements. Phase 2 replaces these with real per-subsystem drivers under tools/perf/src/scenarios/.",
        measurements,
    };

    let json = serde_json::to_string_pretty(&report)?;
    std::fs::write(&args.output, json)?;

    println!(
        "perf: wrote {} measurements to {} (phase=phase_1_synthetic, duration={}s)",
        report.measurements.len(),
        args.output.display(),
        args.duration
    );

    Ok(())
}
