//! Phase 0.4 — round-trip test: every `valid-*.json` sample parses into its
//! generated struct, re-serializes, and matches the original canonical JSON.
//!
//! A mismatch means the generator dropped or renamed a field.

use std::path::{Path, PathBuf};

fn samples_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("protocol/v1/_samples")
}

fn canonicalize(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Object(m) => {
            let mut keys: Vec<_> = m.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonicalize(&m[*k])
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        serde_json::Value::Array(a) => {
            let parts: Vec<String> = a.iter().map(canonicalize).collect();
            format!("[{}]", parts.join(","))
        }
        _ => serde_json::to_string(v).unwrap(),
    }
}

fn roundtrip_value<T: serde::de::DeserializeOwned + serde::Serialize>(path: &Path) {
    let raw = std::fs::read_to_string(path).unwrap();
    let orig: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {path:?}: {e}"));
    let typed: T = serde_json::from_value(orig.clone())
        .unwrap_or_else(|e| panic!("deserialize {path:?}: {e}"));
    let out = serde_json::to_value(&typed).unwrap();
    assert_eq!(
        canonicalize(&orig),
        canonicalize(&out),
        "round-trip mismatch for {path:?}\n  before: {orig}\n  after:  {out}"
    );
}

macro_rules! check_valid_samples {
    ($dir:literal, $ty:ty) => {{
        let p = samples_root().join($dir);
        if !p.is_dir() {
            return;
        }
        let mut count = 0;
        for entry in std::fs::read_dir(&p).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if !name.starts_with("valid-") || !name.ends_with(".json") {
                continue;
            }
            roundtrip_value::<$ty>(&path);
            count += 1;
        }
        assert!(count > 0, "no valid-* samples for {}", $dir);
    }};
}

#[test]
fn evidence_ref_roundtrip() {
    use protocol_rs::v1::evidence_ref::EvidenceRef;
    check_valid_samples!("evidence_ref", EvidenceRef);
}

#[test]
fn assessment_finding_roundtrip() {
    use protocol_rs::v1::assessment_finding::AssessmentFinding;
    check_valid_samples!("assessment_finding", AssessmentFinding);
}

#[test]
fn assessment_run_roundtrip() {
    use protocol_rs::v1::assessment_run::AssessmentRun;
    check_valid_samples!("assessment_run", AssessmentRun);
}

#[test]
fn assessment_verdict_roundtrip() {
    use protocol_rs::v1::assessment_verdict::AssessmentVerdict;
    check_valid_samples!("assessment_verdict", AssessmentVerdict);
}

#[test]
fn assessment_diff_roundtrip() {
    use protocol_rs::v1::assessment_diff::AssessmentDiff;
    check_valid_samples!("assessment_diff", AssessmentDiff);
}

#[test]
fn handoff_packet_roundtrip() {
    use protocol_rs::v1::handoff_packet::HandoffPacket;
    check_valid_samples!("handoff_packet", HandoffPacket);
}

#[test]
fn gate_status_roundtrip() {
    use protocol_rs::v1::gate_status::GateStatus;
    check_valid_samples!("gate_status", GateStatus);
}

#[test]
fn gate_policy_roundtrip() {
    use protocol_rs::v1::gate_policy::GatePolicy;
    check_valid_samples!("gate_policy", GatePolicy);
}

#[test]
fn notify_event_roundtrip() {
    use protocol_rs::v1::notify_event::NotifyEvent;
    check_valid_samples!("notify_event", NotifyEvent);
}

#[test]
fn capability_profile_roundtrip() {
    use protocol_rs::v1::capability_profile::CapabilityProfile;
    check_valid_samples!("capability_profile", CapabilityProfile);
}

#[test]
fn command_roundtrip() {
    use protocol_rs::v1::command::Command;
    check_valid_samples!("command", Command);
}

#[test]
fn event_roundtrip() {
    use protocol_rs::v1::event::Event;
    check_valid_samples!("event", Event);
}

#[test]
fn remediation_plan_roundtrip() {
    use protocol_rs::v1::remediation_plan::RemediationPlan;
    check_valid_samples!("remediation_plan", RemediationPlan);
}
