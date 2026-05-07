//! `command_manifest_refresh` driver — measures the cost of producing
//! a refresh payload from the static command catalog.
//!
//! The bridge's command manifest is a compile-time artifact generated
//! from `config/control-plane/command-manifest.yaml` into
//! `apps/local-bridge/src/generated/command_catalog.rs`. When a client
//! requests the latest manifest (today via the generated
//! `KNOWN_COMMANDS` slice; tomorrow via a dedicated `system.manifest`
//! command), the bridge walks every catalog entry and serialises it
//! to the JSON payload the cockpit consumes. The driver times that
//! walk + serialise pass per refresh, which is the bridge-side cost
//! the cockpit sees on every manifest refresh.
//!
//! The simulated `version` field bumps on each iteration so a future
//! consumer that diffs payloads cannot collapse them into a single
//! cached response — the measurement covers a fresh build per call.
//!
//! Budget: `command_manifest_refresh_p95_ms = 250` (config/slo-budgets.yaml).

use std::time::Instant;

use local_bridge::generated::command_catalog::{CommandScope, COMMAND_CATALOG};
use serde_json::json;

use super::{summarize, Measurement};

/// Number of refresh-payload builds timed per run. 1 000 keeps the
/// driver fast (sub-second on a laptop) while still producing a
/// meaningful p99 for catalog-walk + serde overhead.
pub const SAMPLE_COUNT: u64 = 1_000;

const SUBSYSTEM: &str = "command_manifest_refresh";

pub fn measure() -> anyhow::Result<Measurement> {
    let mut samples_ns: Vec<u128> = Vec::with_capacity(SAMPLE_COUNT as usize);
    for v in 0..SAMPLE_COUNT {
        let started = Instant::now();
        let payload = refresh_payload(v);
        // Serialise to a String to fully exercise the wire path; the
        // result is intentionally discarded.
        let _serialised = serde_json::to_string(&payload)?;
        samples_ns.push(started.elapsed().as_nanos());
    }
    Ok(summarize(SUBSYSTEM, samples_ns))
}

fn refresh_payload(version: u64) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = COMMAND_CATALOG
        .iter()
        .map(|e| {
            json!({
                "id": e.id,
                "status": e.status.as_str(),
                "scope": match e.scope {
                    CommandScope::Sessionless => "sessionless",
                    CommandScope::Session => "session",
                    CommandScope::Either => "either",
                },
                "side_effect": e.side_effect.as_str(),
            })
        })
        .collect();
    json!({
        "version": version,
        "command_count": entries.len(),
        "commands": entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_payload_includes_every_catalog_entry() {
        let payload = refresh_payload(7);
        assert_eq!(payload["version"], 7);
        let commands = payload["commands"].as_array().expect("commands array");
        assert_eq!(commands.len(), COMMAND_CATALOG.len());
        // Spot-check a known catalog entry (system.ping is a stable
        // implemented sessionless ping).
        let ping = commands
            .iter()
            .find(|c| c["id"] == "system.ping")
            .expect("system.ping in payload");
        assert_eq!(ping["status"], "implemented");
        assert_eq!(ping["scope"], "sessionless");
    }

    #[test]
    fn measure_returns_well_formed_measurement() {
        let m = measure().expect("measure should succeed");
        assert_eq!(m.subsystem, SUBSYSTEM);
        assert_eq!(m.sample_count, SAMPLE_COUNT);
        assert!(m.p50_ms >= 0.0);
        assert!(m.p95_ms >= m.p50_ms);
        assert!(m.p99_ms >= m.p95_ms);
    }
}
