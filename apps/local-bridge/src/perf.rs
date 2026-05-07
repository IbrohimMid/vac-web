//! Slice #5 — `perf.latest_run` handler.
//!
//! Reads `.perf-baseline/history.jsonl` (overridable via env
//! `VAC_PERF_HISTORY_PATH`), returns the latest entry plus a simple
//! regression check vs the median of the prior 10 entries. The
//! command is sessionless; no profile-layer gate applies.
//!
//! Status mapping:
//!
//! - `unknown` — history file missing or empty.
//! - `ok` — history present and no regression > 25%.
//! - `warn` — at least one metric exceeds the regression threshold
//!   vs the rolling median (mirrors `scripts/perf-baseline-compare.mjs`).

use std::env;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::server::AppStateHandle;
use crate::ws::envelope::{ClientCommand, ServerAck, ServerEvent};

const ENV_PATH: &str = "VAC_PERF_HISTORY_PATH";
const DEFAULT_PATH: &str = ".perf-baseline/history.jsonl";
const WINDOW: usize = 10;
const REGRESSION_PCT: f64 = 25.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerfEntry {
    pub recorded_at: String,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub r#ref: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    pub measurements: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Regression {
    pub measurement: String,
    pub metric: String,
    pub latest: f64,
    pub baseline: f64,
    pub delta_pct: f64,
}

fn history_path() -> PathBuf {
    match env::var(ENV_PATH) {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => PathBuf::from(DEFAULT_PATH),
    }
}

pub fn read_entries() -> Vec<PerfEntry> {
    let path = history_path();
    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<PerfEntry>(l).ok())
        .collect()
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut s: Vec<f64> = values.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = s.len();
    Some(if n % 2 == 1 {
        s[n / 2]
    } else {
        (s[n / 2 - 1] + s[n / 2]) / 2.0
    })
}

pub fn detect_regressions(entries: &[PerfEntry]) -> Vec<Regression> {
    if entries.len() < 2 {
        return vec![];
    }
    let latest = &entries[entries.len() - 1];
    let start = entries.len().saturating_sub(1).saturating_sub(WINDOW);
    let window = &entries[start..entries.len() - 1];
    if window.is_empty() {
        return vec![];
    }
    let metrics = ["p95_ms", "median_ms", "p99_ms"];
    let mut regressions = Vec::new();
    let latest_obj = match latest.measurements.as_object() {
        Some(o) => o,
        None => return vec![],
    };
    for (name, latest_row) in latest_obj {
        let latest_row = match latest_row.as_object() {
            Some(o) => o,
            None => continue,
        };
        for metric in metrics {
            let latest_val = match latest_row.get(metric).and_then(Value::as_f64) {
                Some(v) if v.is_finite() => v,
                _ => continue,
            };
            let window_vals: Vec<f64> = window
                .iter()
                .filter_map(|e| {
                    e.measurements
                        .get(name)
                        .and_then(|m| m.get(metric))
                        .and_then(Value::as_f64)
                        .filter(|v| v.is_finite())
                })
                .collect();
            let baseline = match median(&window_vals) {
                Some(b) if b > 0.0 => b,
                _ => continue,
            };
            let delta_pct = ((latest_val - baseline) / baseline) * 100.0;
            if delta_pct > REGRESSION_PCT {
                regressions.push(Regression {
                    measurement: name.clone(),
                    metric: metric.into(),
                    latest: latest_val,
                    baseline,
                    delta_pct: (delta_pct * 100.0).round() / 100.0,
                });
            }
        }
    }
    regressions
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn build_payload() -> Value {
    let entries = read_entries();
    if entries.is_empty() {
        return json!({
            "status": "unknown",
            "latest": Value::Null,
            "regressions": [],
        });
    }
    let regressions = detect_regressions(&entries);
    let status = if regressions.is_empty() { "ok" } else { "warn" };
    let latest = entries.last().expect("non-empty");
    json!({
        "status": status,
        "latest": latest,
        "regressions": regressions,
    })
}

pub async fn handle_latest_run(
    cmd: &ClientCommand,
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let payload = build_payload();
    let event = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "perf.run_completed".into(),
        payload,
        v: 1,
        ts: now_iso(),
    };
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![event],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn write_history(dir: &TempDir, content: &str) -> PathBuf {
        let path = dir.path().join("history.jsonl");
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn missing_history_returns_unknown() {
        let _g = lock();
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("nope.jsonl");
        env::set_var(ENV_PATH, &p);
        let v = build_payload();
        env::remove_var(ENV_PATH);
        assert_eq!(v["status"], "unknown");
        assert!(v["latest"].is_null());
    }

    #[test]
    fn single_entry_returns_ok() {
        let _g = lock();
        let dir = TempDir::new().unwrap();
        let line = serde_json::to_string(&json!({
            "recorded_at": "2026-05-07T00:00:00Z",
            "commit": "abc123",
            "ref": "refs/heads/main",
            "run_id": "1",
            "measurements": {"hot_path": {"p95_ms": 10.0, "median_ms": 5.0, "p99_ms": 12.0}}
        }))
        .unwrap();
        let p = write_history(&dir, &(line + "\n"));
        env::set_var(ENV_PATH, &p);
        let v = build_payload();
        env::remove_var(ENV_PATH);
        assert_eq!(v["status"], "ok");
        assert!(v["regressions"].as_array().unwrap().is_empty());
        assert_eq!(v["latest"]["commit"], "abc123");
    }

    #[test]
    fn regression_above_threshold_flagged_as_warn() {
        let _g = lock();
        let dir = TempDir::new().unwrap();
        let mut lines = String::new();
        for _ in 0..3 {
            lines.push_str(
                &serde_json::to_string(&json!({
                    "recorded_at": "2026-05-06T00:00:00Z",
                    "measurements": {"hot": {"p95_ms": 10.0, "median_ms": 5.0, "p99_ms": 12.0}}
                }))
                .unwrap(),
            );
            lines.push('\n');
        }
        lines.push_str(
            &serde_json::to_string(&json!({
                "recorded_at": "2026-05-07T00:00:00Z",
                "measurements": {"hot": {"p95_ms": 20.0, "median_ms": 5.0, "p99_ms": 12.0}}
            }))
            .unwrap(),
        );
        lines.push('\n');
        let p = write_history(&dir, &lines);
        env::set_var(ENV_PATH, &p);
        let v = build_payload();
        env::remove_var(ENV_PATH);
        assert_eq!(v["status"], "warn");
        let regs = v["regressions"].as_array().unwrap();
        assert!(!regs.is_empty());
        assert!(regs.iter().any(|r| r["metric"] == "p95_ms"));
    }
}
