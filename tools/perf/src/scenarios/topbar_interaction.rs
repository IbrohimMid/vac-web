//! `topbar_interaction` driver — measures latency from a topbar UI action
//! (click on the Settings button) to the resulting Settings overlay
//! becoming visible in the cockpit shell.
//!
//! Approach:
//! 1. Spawn the dedicated Playwright `perf` project (test directory
//!    `apps/web/tests/perf/`, configured in `apps/web/playwright.config.ts`).
//!    Playwright boots `vite preview` (production bundle) and the spec
//!    wires a deterministic `MockBridge` so the cockpit shell renders the
//!    real `Topbar` + `SettingsPage` components without depending on a
//!    live local-bridge.
//! 2. The spec runs 5 warmup iterations (discarded; cover cold render,
//!    allocator warmup, vite preview JIT) followed by 50 timed iterations.
//!    Each iteration brackets in-page `performance.now()` around
//!    `button.click()` → `requestAnimationFrame` poll until the
//!    `[data-testid="settings-overlay"]` element is computed-visible.
//! 3. The spec writes a single-line JSON payload
//!    `{ subsystem, samples_ms: [...] }` to the path passed via the
//!    `VAC_PERF_OUTPUT` env var.
//! 4. This driver reads that payload, converts ms → ns (u128), and hands
//!    the samples to [`super::summarize`] for shared p50/p95/p99 reduction.
//!
//! Why a separate harness?
//!   The other four drivers run in-process. Topbar interaction latency
//!   inherently includes click dispatch + React render commit + layout +
//!   paint, which can only be measured from inside a real browser.
//!   Playwright was already wired for the e2e suite; this driver piggybacks
//!   on that toolchain rather than introducing a second browser harness.
//!
//! Budget: `topbar_interaction_p95_ms = 100` (`config/slo-budgets.yaml`).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tempfile::NamedTempFile;

use super::{summarize, Measurement};

/// Number of timed click → overlay-visible measurements emitted by the
/// Playwright spec. Mirrors
/// `apps/web/tests/perf/topbar_interaction.spec.ts::TIMED_SAMPLES`.
pub const SAMPLE_COUNT: u64 = 50;

const SUBSYSTEM: &str = "topbar_interaction";

#[derive(Debug, Deserialize)]
struct PlaywrightPayload {
    subsystem: String,
    samples_ms: Vec<f64>,
}

/// Run the Playwright `perf` project and reduce its raw per-iteration
/// samples into a shared `Measurement`. Returns an error if Playwright
/// fails, the JSON payload is malformed, or the sample count diverges
/// from the spec's `TIMED_SAMPLES` constant (drift guard).
pub fn measure() -> anyhow::Result<Measurement> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let repo_root = PathBuf::from(manifest_dir).join("../..");
    let output = NamedTempFile::new()?;
    let output_path = output.path().to_path_buf();

    let payload = run_playwright(&repo_root, &output_path)?;

    if payload.subsystem != SUBSYSTEM {
        anyhow::bail!(
            "playwright payload subsystem mismatch: expected {SUBSYSTEM}, got {}",
            payload.subsystem
        );
    }
    if payload.samples_ms.len() as u64 != SAMPLE_COUNT {
        anyhow::bail!(
            "playwright payload sample count mismatch: expected {SAMPLE_COUNT}, got {}",
            payload.samples_ms.len()
        );
    }

    // Convert ms (f64) → ns (u128) for the shared `summarize()` reducer
    // that the other four real drivers also use.
    let samples_ns: Vec<u128> = payload
        .samples_ms
        .iter()
        .map(|ms| (ms * 1_000_000.0).round() as u128)
        .collect();

    Ok(summarize(SUBSYSTEM, samples_ns))
}

fn run_playwright(repo_root: &Path, output_path: &Path) -> anyhow::Result<PlaywrightPayload> {
    let output = Command::new("pnpm")
        .args([
            "-F",
            "web",
            "exec",
            "playwright",
            "test",
            "--project=perf",
            "--reporter=line",
        ])
        .env("VAC_PERF_OUTPUT", output_path)
        .current_dir(repo_root)
        .output()
        .map_err(|e| anyhow::anyhow!("failed to spawn pnpm playwright: {e}"))?;

    if !output.status.success() {
        anyhow::bail!(
            "playwright exit {}: stdout={}, stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let payload_text = std::fs::read_to_string(output_path).map_err(|e| {
        anyhow::anyhow!("failed to read playwright payload at {output_path:?}: {e}")
    })?;
    let trimmed = payload_text.trim();
    if trimmed.is_empty() {
        anyhow::bail!("playwright payload at {output_path:?} is empty");
    }
    serde_json::from_str(trimmed)
        .map_err(|e| anyhow::anyhow!("failed to parse playwright payload: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real driver smoke test — requires `pnpm` + Chromium installed.
    /// Run manually with:
    ///   `cargo test -p perf --features real_scenarios -- --ignored topbar_interaction`
    #[test]
    #[ignore = "requires pnpm + playwright chromium installed"]
    fn measure_returns_well_formed_measurement() {
        let m = measure().expect("playwright perf driver should succeed");
        assert_eq!(m.subsystem, SUBSYSTEM);
        assert_eq!(m.sample_count, SAMPLE_COUNT);
        assert!(m.p50_ms >= 0.0);
        assert!(m.p95_ms >= m.p50_ms);
        assert!(m.p99_ms >= m.p95_ms);
    }
}
