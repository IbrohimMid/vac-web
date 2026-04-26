//! Assessment candidate validation for the bridge.
//!
//! Converts worker candidate output into validated finding / evidence payloads
//! and rejects malformed or duplicate candidates before they reach the UI.

use crate::agent_runtime::acp::sha256_hex_canonical;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use ulid::Ulid;

const VALID_CATEGORIES: &[&str] = &["technical", "product", "ux", "release", "ops"];
const VALID_SEVERITIES: &[&str] = &["info", "low", "medium", "high", "critical"];
const EVIDENCE_TTL_SECS: u64 = 3600;
const CRITICAL_CONFIDENCE_MIN: f64 = 0.7;

#[derive(Debug, Default)]
pub struct AssessmentValidationTracker {
    seen_identity_hashes: HashMap<String, HashSet<String>>,
}

impl AssessmentValidationTracker {
    pub fn seen_identity_hashes(&self, run_id: &str) -> Option<&HashSet<String>> {
        self.seen_identity_hashes.get(run_id)
    }

    fn mark_identity_hash(&mut self, run_id: &str, identity_hash: &str) -> bool {
        self.seen_identity_hashes
            .entry(run_id.to_string())
            .or_default()
            .insert(identity_hash.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateRejection {
    pub reason: String,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct CandidateFinding {
    pub title: String,
    pub summary: String,
    pub finding_event: Value,
    pub evidence_events: Vec<Value>,
}

pub fn validate_candidate(
    project_root: &Path,
    tracker: &mut AssessmentValidationTracker,
    run_id: &str,
    candidate: &Value,
    source_event_type: &str,
) -> Result<CandidateFinding, CandidateRejection> {
    let candidate_hash = sha256_hex_canonical(candidate);

    let title = required_string(candidate, &["title"])?;
    if title.trim().is_empty() {
        return Err(rejection(
            "invalid_schema",
            "title must not be empty".to_string(),
        ));
    }
    if title.chars().count() > 120 {
        return Err(rejection(
            "title_too_long",
            format!("title too long: {}", title.chars().count()),
        ));
    }

    let category = required_string(candidate, &["category"])?;
    if !VALID_CATEGORIES.contains(&category.as_str()) {
        return Err(rejection(
            "invalid_category",
            format!("unsupported category: {category}"),
        ));
    }

    let severity = required_string(candidate, &["severity"])?;
    if !VALID_SEVERITIES.contains(&severity.as_str()) {
        return Err(rejection(
            "invalid_severity",
            format!("unsupported severity: {severity}"),
        ));
    }

    let confidence = required_f64(candidate, &["confidence"])?;
    if !(0.0..=1.0).contains(&confidence) || !confidence.is_finite() {
        return Err(rejection(
            "invalid_confidence",
            format!("confidence out of range: {confidence}"),
        ));
    }
    if severity == "critical" && confidence < CRITICAL_CONFIDENCE_MIN {
        return Err(rejection(
            "critical_confidence_floor",
            format!("critical confidence below {:.1}", CRITICAL_CONFIDENCE_MIN),
        ));
    }

    let identity_hash = required_string(candidate, &["identityHash", "identity_hash"])?;
    if identity_hash.trim().is_empty() {
        return Err(rejection(
            "identity_hash_missing",
            "identity hash must not be empty".to_string(),
        ));
    }
    if !identity_hash.starts_with("sha256:") || identity_hash.len() != 71 {
        return Err(rejection(
            "identity_hash_invalid",
            "identity hash must use sha256:<64 hex>".to_string(),
        ));
    }

    let evidence_entries = required_array(candidate, &["evidence"])?;
    if evidence_entries.is_empty() {
        return Err(rejection(
            "missing_evidence",
            "candidate must include at least one evidence ref".to_string(),
        ));
    }

    let description = optional_string(candidate, &["description"]).unwrap_or_default();
    let rationale = optional_string(candidate, &["rationale"]).unwrap_or_default();
    let recommendation = optional_string(candidate, &["recommendation"]);
    let fixability = optional_string(candidate, &["fixability"]);
    let owner_hint = optional_string(candidate, &["ownerHint", "owner_hint"]);
    let emitted_by = optional_string(candidate, &["emittedBy", "emitted_by"]);

    let tags: Vec<String> = candidate
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let mut evidence_events = Vec::with_capacity(evidence_entries.len());
    let mut evidence_ids = Vec::with_capacity(evidence_entries.len());
    let project_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());

    for raw in evidence_entries {
        let evidence = validate_evidence(&project_root, raw)?;
        evidence_ids.push(evidence.id.clone());
        evidence_events.push(evidence.payload);
    }

    let subject = evidence_subject(evidence_entries[0].as_object(), &project_root);
    let check = recommendation
        .clone()
        .or_else(|| optional_string(candidate, &["rationale"]))
        .or_else(|| optional_string(candidate, &["description"]))
        .unwrap_or_else(|| "candidate validation".to_string());
    let summary = if description.is_empty() {
        if rationale.is_empty() {
            check.clone()
        } else {
            rationale.clone()
        }
    } else {
        description.clone()
    };

    if tracker
        .seen_identity_hashes(run_id)
        .is_some_and(|seen| seen.contains(&identity_hash))
    {
        return Err(rejection(
            "duplicate_identity_hash",
            format!("duplicate identity hash: {identity_hash}"),
        ));
    }

    tracker.mark_identity_hash(run_id, &identity_hash);

    let finding_id = format!("fnd_{}", Ulid::new());
    let finding_event = json!({
        "finding_id": finding_id,
        "identity_hash": identity_hash,
        "run_id": run_id,
        "category": category,
        "subject": subject,
        "check": check,
        "severity": severity,
        "confidence": confidence,
        "title": title,
        "summary": summary,
        "evidence_ids": evidence_ids,
        "emitted_at": chrono::Utc::now().to_rfc3339(),
        "description": description,
        "rationale": rationale,
        "recommendation": recommendation,
        "fixability": fixability,
        "owner_hint": owner_hint,
        "tags": tags,
        "candidate_hash": candidate_hash,
        "source_event_type": source_event_type,
        "emitted_by": emitted_by,
    });

    Ok(CandidateFinding {
        title,
        summary,
        finding_event,
        evidence_events,
    })
}

fn validate_evidence(
    project_root: &Path,
    raw: &Value,
) -> Result<ValidatedEvidence, CandidateRejection> {
    if !raw.is_object() {
        return Err(rejection(
            "invalid_schema",
            "evidence entry must be an object".to_string(),
        ));
    }
    let kind = required_string(raw, &["kind"])?;
    if kind != "file" {
        return Err(rejection(
            "unsupported_evidence_kind",
            format!("unsupported evidence kind: {kind}"),
        ));
    }

    let raw_path = optional_string(raw, &["path"])
        .map(PathBuf::from)
        .or_else(|| optional_string(raw, &["uri"]).map(|s| strip_file_uri(&s)))
        .ok_or_else(|| {
            rejection(
                "invalid_schema",
                "evidence path or uri is required".to_string(),
            )
        })?;

    if raw_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(rejection(
            "evidence_outside_project_root",
            format!("evidence path escapes project root: {}", raw_path.display()),
        ));
    }

    let resolved = if raw_path.is_absolute() {
        raw_path.clone()
    } else {
        project_root.join(&raw_path)
    };

    if !resolved.starts_with(project_root) {
        return Err(rejection(
            "evidence_outside_project_root",
            format!(
                "evidence path is outside project root: {}",
                raw_path.display()
            ),
        ));
    }

    if !resolved.is_file() {
        return Err(rejection(
            "evidence_file_missing",
            format!("evidence file not found: {}", raw_path.display()),
        ));
    }

    let body = fs::read_to_string(&resolved).map_err(|_| {
        rejection(
            "evidence_file_missing",
            format!("evidence file not readable: {}", raw_path.display()),
        )
    })?;
    let line_count = body.lines().count() as u64;
    let line = optional_u64(raw, &["line", "locator.line"]);
    let range = optional_range(raw, &["range", "line_range", "locator.line_range"]);

    if let Some(line) = line {
        if line == 0 || line > line_count {
            return Err(rejection(
                "evidence_line_missing",
                format!("evidence line {line} not found in {}", raw_path.display()),
            ));
        }
    }

    if let Some((start, end)) = range {
        if start == 0 || end < start || end > line_count {
            return Err(rejection(
                "evidence_range_missing",
                format!(
                    "evidence range {start}-{end} not found in {}",
                    raw_path.display()
                ),
            ));
        }
    }

    let label = match (line, range) {
        (Some(line), _) => format!("{}:{line}", display_path(project_root, &resolved)),
        (_, Some((start, end))) => {
            format!("{}:{start}-{end}", display_path(project_root, &resolved))
        }
        _ => display_path(project_root, &resolved),
    };

    let locator = if let Some((start, end)) = range {
        json!({ "line_range": [start, end] })
    } else if let Some(line) = line {
        json!({ "line": line })
    } else {
        json!({})
    };

    let id = format!("ev_{}", Ulid::new());
    let payload = json!({
        "id": id,
        "connector": "filesystem",
        "kind": "file",
        "label": label,
        "captured_at": chrono::Utc::now().to_rfc3339(),
        "ttl_seconds": EVIDENCE_TTL_SECS,
        "uri": format!("file://{}", resolved.display()),
        "locator": locator,
        "source_event_type": "assessment.candidate_received",
    });

    Ok(ValidatedEvidence { id, payload })
}

fn evidence_subject(raw: Option<&serde_json::Map<String, Value>>, project_root: &Path) -> String {
    let Some(raw) = raw else {
        return "candidate evidence".to_string();
    };
    let resolved = raw
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| {
            raw.get("uri")
                .and_then(Value::as_str)
                .map(strip_file_uri_str)
        })
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                project_root.join(path)
            }
        });
    let Some(path) = resolved else {
        return "candidate evidence".to_string();
    };
    let display = display_path(project_root, &path);
    if let Some(line) = optional_u64(&Value::Object(raw.clone()), &["line", "locator.line"]) {
        format!("{display}:{line}")
    } else if let Some((start, end)) = optional_range(
        &Value::Object(raw.clone()),
        &["range", "line_range", "locator.line_range"],
    ) {
        format!("{display}:{start}-{end}")
    } else {
        display
    }
}

fn display_path(project_root: &Path, resolved: &Path) -> String {
    resolved
        .strip_prefix(project_root)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| resolved.display().to_string())
}

fn strip_file_uri(uri: &str) -> PathBuf {
    PathBuf::from(strip_file_uri_str(uri))
}

fn strip_file_uri_str(uri: &str) -> &str {
    uri.strip_prefix("file://").unwrap_or(uri)
}

fn rejection(reason: &str, summary: String) -> CandidateRejection {
    CandidateRejection {
        reason: reason.to_string(),
        summary,
    }
}

fn required_string(value: &Value, keys: &[&str]) -> Result<String, CandidateRejection> {
    optional_string(value, keys).ok_or_else(|| {
        rejection(
            "invalid_schema",
            format!("missing required string field: {}", keys[0]),
        )
    })
}

fn optional_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value_at(value, key).and_then(Value::as_str) {
            return Some(v.to_string());
        }
    }
    None
}

fn required_f64(value: &Value, keys: &[&str]) -> Result<f64, CandidateRejection> {
    optional_f64(value, keys).ok_or_else(|| {
        rejection(
            "invalid_schema",
            format!("missing required numeric field: {}", keys[0]),
        )
    })
}

fn optional_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(v) = value_at(value, key).and_then(Value::as_f64) {
            return Some(v);
        }
    }
    None
}

fn optional_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(v) = value_at(value, key).and_then(Value::as_u64) {
            return Some(v);
        }
    }
    None
}

fn optional_range(value: &Value, keys: &[&str]) -> Option<(u64, u64)> {
    for key in keys {
        let Some(node) = value_at(value, key) else {
            continue;
        };
        if let Some(arr) = node.as_array() {
            if arr.len() >= 2 {
                let start = arr.first()?.as_u64()?;
                let end = arr.get(1)?.as_u64()?;
                return Some((start, end));
            }
        }
    }
    None
}

fn required_array<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a [Value], CandidateRejection> {
    for key in keys {
        if let Some(arr) = value_at(value, key).and_then(Value::as_array) {
            return Ok(arr.as_slice());
        }
    }
    Err(rejection(
        "invalid_schema",
        format!("missing required array field: {}", keys[0]),
    ))
}

fn value_at<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    if let Some((head, tail)) = key.split_once('.') {
        value.get(head).and_then(|child| value_at(child, tail))
    } else {
        value.get(key)
    }
}

struct ValidatedEvidence {
    id: String,
    payload: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_file(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn candidate(path: &str, line: u64) -> Value {
        json!({
            "title": "Idempotency keys stored without expiry binding",
            "category": "technical",
            "severity": "critical",
            "confidence": 0.91,
            "description": "Redis entries persist beyond the dedupe window.",
            "rationale": "A stale idempotency key can mask or replay payment state.",
            "recommendation": "Bind expiry to the monotonic store and verify on replay.",
            "evidence": [
                { "kind": "file", "path": path, "line": line }
            ],
            "fixability": "assisted",
            "identityHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "emittedBy": "agent_1",
        })
    }

    #[test]
    fn validates_candidate_and_builds_payloads() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_file(root, "src/handlers/charge.rs", "line 1\nline 2\n");
        let mut tracker = AssessmentValidationTracker::default();
        let validated = validate_candidate(
            root,
            &mut tracker,
            "run_01",
            &candidate("src/handlers/charge.rs", 2),
            "assessment.candidate_received",
        )
        .unwrap();

        assert_eq!(
            validated.title,
            "Idempotency keys stored without expiry binding"
        );
        assert_eq!(validated.evidence_events.len(), 1);
        assert_eq!(
            validated.finding_event["subject"].as_str().unwrap(),
            "src/handlers/charge.rs:2"
        );
        assert_eq!(
            validated.finding_event["evidence_ids"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(tracker
            .seen_identity_hashes("run_01")
            .unwrap()
            .contains("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn rejects_duplicate_identity_hash() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_file(root, "src/handlers/charge.rs", "line 1\nline 2\n");
        let mut tracker = AssessmentValidationTracker::default();
        validate_candidate(
            root,
            &mut tracker,
            "run_01",
            &candidate("src/handlers/charge.rs", 1),
            "assessment.candidate_received",
        )
        .unwrap();
        let err = validate_candidate(
            root,
            &mut tracker,
            "run_01",
            &candidate("src/handlers/charge.rs", 1),
            "assessment.candidate_received",
        )
        .unwrap_err();
        assert_eq!(err.reason, "duplicate_identity_hash");
    }

    #[test]
    fn rejects_missing_evidence_file() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let mut tracker = AssessmentValidationTracker::default();
        let err = validate_candidate(
            root,
            &mut tracker,
            "run_01",
            &candidate("src/handlers/charge.rs", 1),
            "assessment.candidate_received",
        )
        .unwrap_err();
        assert_eq!(err.reason, "evidence_file_missing");
    }
}
