//! VAC backend perf harness — slice 41 follow-up (R6, 2026-05-06).
//!
//! Default mode (no features): produce a JSON measurement document with the
//! shape `scripts/check-slo-measurements.mjs` expects to compare against
//! `config/slo-budgets.yaml`. Measurements are SYNTHETIC (deterministic
//! placeholder values intentionally below budgets) so the contract works
//! end-to-end in CI and locally.
//!
//! `--features real_scenarios`: per-subsystem real drivers under
//! `src/scenarios/` are dispatched via [`scenarios::try_measure`]. Drivers
//! land incrementally — any subsystem without a real driver yet keeps its
//! synthetic placeholder. The `phase` field in the report is bumped to
//! `phase_2_partial` whenever at least one real driver fires so consumers
//! can tell the run was hybrid.
//!
//! Acceptance from `docs/plans/wiring/remaining-work-execution-plan-2026-05-06.md`:
//! - `cargo run -p perf -- --duration 60 --output perf-results.json` runs
//!   locally and produces valid JSON.
//! - `node scripts/check-slo-measurements.mjs perf-results.json` exits 0 when
//!   all p95s are within budget; exits 1 with diagnostic when any exceeds
//!   (strict mode).

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::{Deserialize, Serialize};

// Phase 2 real per-subsystem drivers. Gated behind the `real_scenarios`
// feature so Phase 1 synthetic measurements remain the default until each
// driver has landed and stabilised.
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
pub struct Measurement {
    pub subsystem: String,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub sample_count: u64,
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

const SYNTHETIC_PHASE: &str = "phase_1_synthetic";
const SYNTHETIC_NOTE: &str = "Phase 1 ships synthetic deterministic measurements. Phase 2 replaces these with real per-subsystem drivers under tools/perf/src/scenarios/.";

#[cfg(feature = "real_scenarios")]
const HYBRID_PHASE: &str = "phase_2_partial";
#[cfg(feature = "real_scenarios")]
const HYBRID_NOTE: &str = "Phase 2 partial: real drivers replace synthetic placeholders for the subsystems registered in tools/perf/src/scenarios/mod.rs::try_measure; remaining rows stay synthetic until their drivers land.";

fn synthetic_measurements() -> Vec<Measurement> {
    vec![
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
    ]
}

fn build_measurements() -> anyhow::Result<(Vec<Measurement>, &'static str, &'static str)> {
    #[allow(unused_mut)]
    let mut measurements = synthetic_measurements();

    #[cfg(feature = "real_scenarios")]
    {
        let mut any_real = false;
        for m in measurements.iter_mut() {
            if let Some(real) = scenarios::try_measure(&m.subsystem)? {
                *m = real;
                any_real = true;
            }
        }
        if any_real {
            return Ok((measurements, HYBRID_PHASE, HYBRID_NOTE));
        }
    }

    Ok((measurements, SYNTHETIC_PHASE, SYNTHETIC_NOTE))
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let (measurements, phase, note) = build_measurements()?;

    let captured_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let report = PerfReport {
        schema_version: 1,
        captured_at_unix_seconds: captured_at,
        duration_seconds: args.duration,
        measurement_only: args.measurement_only,
        phase,
        note,
        measurements,
    };

    let json = serde_json::to_string_pretty(&report)?;
    std::fs::write(&args.output, json)?;

    println!(
        "perf: wrote {} measurements to {} (phase={}, duration={}s)",
        report.measurements.len(),
        args.output.display(),
        phase,
        args.duration
    );

    Ok(())
}
