//! WorkerOutputV1 envelope validator.
//!
//! P4 of the assessment durability milestone. Worker (sub-agent) output is
//! free-form JSON today: anything the LLM emits is fed into
//! `candidate_payloads_from_worker_event`, which uses heuristics to find a
//! `candidates` array, a single `candidate`, or an inline finding. That is
//! permissive on purpose — ACP workers vary widely — but it makes it hard
//! to detect malformed output (missing required fields, unsupported
//! schema versions, garbage values) until much deeper in the pipeline.
//!
//! This module adds a *non-fatal* envelope check that runs before the
//! existing heuristic. When the worker emits a recognisable v1 envelope
//! we validate the required fields; mismatches surface as a structured
//! [`WorkerOutputRejection`] that the caller can turn into an
//! `assessment.worker_output_rejected` event. We never reject *all*
//! worker output for failing the envelope — the heuristic path is still
//! consulted as a fallback so plain JSON-array workers keep working.
//!
//! ## Envelope shape
//!
//! ```jsonc
//! {
//!   "schema_version": 1,        // required, must be 1 today
//!   "swarm": "rtd",             // optional, free-form
//!   "agent_role": "...",        // optional
//!   "candidates": [             // required, may be empty
//!     { "title": "...", "category": "...", "severity": "...", ... }
//!   ]
//! }
//! ```
//!
//! Future schema versions may add fields; the validator only enforces a
//! minimum contract for v1.

use serde_json::Value;

pub const WORKER_OUTPUT_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerOutputV1 {
    pub schema_version: u64,
    pub swarm: Option<String>,
    pub agent_role: Option<String>,
    pub candidates: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerOutputRejection {
    /// Stable error code suitable for `assessment.worker_output_rejected`.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Stable low-cardinality classification for the frontend.
    pub reason: String,
    /// Optional JSON pointer-ish path to the bad field, e.g.
    /// `"candidates[2].severity"`.
    pub path: Option<String>,
}

impl WorkerOutputRejection {
    pub fn new(
        code: impl Into<String>,
        reason: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            reason: reason.into(),
            message: message.into(),
            path: None,
        }
    }

    pub fn at(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    /// Render to the JSON payload we attach to
    /// `assessment.worker_output_rejected`.
    pub fn to_event_payload(&self, run_id: &str) -> Value {
        serde_json::json!({
            "run_id": run_id,
            "reason": self.reason,
            "code": self.code,
            "message": self.message,
            "path": self.path,
        })
    }
}

/// Result of envelope detection.
///
/// - `Recognised` means the payload had the v1 envelope marker (a
///   `schema_version` field) and either parsed cleanly or produced a
///   structured rejection.
/// - `NotEnvelope` means the payload did not look like an envelope at
///   all; the caller should fall back to the legacy heuristic.
pub enum EnvelopeOutcome {
    Recognised(Result<WorkerOutputV1, WorkerOutputRejection>),
    NotEnvelope,
}

/// Detect + validate a worker output envelope.
pub fn validate_worker_output(value: &Value) -> EnvelopeOutcome {
    let Some(obj) = value.as_object() else {
        return EnvelopeOutcome::NotEnvelope;
    };
    let Some(schema_field) = obj.get("schema_version") else {
        return EnvelopeOutcome::NotEnvelope;
    };

    if matches!(schema_field, Value::Null) {
        return EnvelopeOutcome::Recognised(Err(WorkerOutputRejection::new(
            "empty_output",
            "empty_output",
            "worker output was empty",
        )));
    }

    let Some(schema_version) = schema_field.as_u64() else {
        return EnvelopeOutcome::Recognised(Err(WorkerOutputRejection::new(
            "schema_version_invalid",
            "schema_invalid",
            format!("schema_version must be an unsigned integer; got {schema_field}"),
        )
        .at("schema_version")));
    };

    if schema_version != WORKER_OUTPUT_SCHEMA_VERSION {
        return EnvelopeOutcome::Recognised(Err(WorkerOutputRejection::new(
            "schema_version_unsupported",
            "schema_version_unsupported",
            format!(
                "unsupported worker output schema_version {schema_version} \
                 (this bridge supports {WORKER_OUTPUT_SCHEMA_VERSION})"
            ),
        )
        .at("schema_version")));
    }

    let candidates_field = match obj.get("candidates") {
        Some(v) => v,
        None => {
            return EnvelopeOutcome::Recognised(Err(WorkerOutputRejection::new(
                "missing_candidates",
                "schema_invalid",
                "v1 envelope requires a `candidates` array (may be empty)",
            )));
        }
    };
    let Some(arr) = candidates_field.as_array() else {
        return EnvelopeOutcome::Recognised(Err(WorkerOutputRejection::new(
            "candidates_not_array",
            "schema_invalid",
            "`candidates` must be a JSON array",
        )
        .at("candidates")));
    };

    for (idx, c) in arr.iter().enumerate() {
        if let Err(rej) = validate_candidate_v1(c, idx) {
            return EnvelopeOutcome::Recognised(Err(rej));
        }
    }

    let swarm = obj
        .get("swarm")
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let agent_role = obj
        .get("agent_role")
        .and_then(Value::as_str)
        .map(|s| s.to_string());

    EnvelopeOutcome::Recognised(Ok(WorkerOutputV1 {
        schema_version,
        swarm,
        agent_role,
        candidates: arr.clone(),
    }))
}

fn validate_candidate_v1(candidate: &Value, idx: usize) -> Result<(), WorkerOutputRejection> {
    let path = format!("candidates[{idx}]");
    let Some(obj) = candidate.as_object() else {
        return Err(WorkerOutputRejection::new(
            "candidate_not_object",
            "candidate_schema_invalid",
            "candidate must be a JSON object",
        )
        .at(path));
    };

    // Title is the only field we hard-require at the envelope layer; deeper
    // validation (severity bucket, category bucket, identity_hash) lives in
    // validate_candidate() which has access to the project state.
    let title = obj.get("title").and_then(Value::as_str).unwrap_or("");
    if title.trim().is_empty() {
        return Err(WorkerOutputRejection::new(
            "candidate_missing_title",
            "candidate_schema_invalid",
            "each candidate must have a non-empty `title`",
        )
        .at(format!("{path}.title")));
    }

    if let Some(sev) = obj.get("severity").and_then(Value::as_str) {
        if !is_known_severity(sev) {
            return Err(WorkerOutputRejection::new(
                "candidate_severity_invalid",
                "candidate_schema_invalid",
                format!("severity must be one of critical/high/medium/low/info; got `{sev}`"),
            )
            .at(format!("{path}.severity")));
        }
    }

    Ok(())
}

fn is_known_severity(s: &str) -> bool {
    matches!(
        s.to_ascii_lowercase().as_str(),
        "critical" | "high" | "medium" | "low" | "info"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unwrap_recognised(
        outcome: EnvelopeOutcome,
    ) -> Result<WorkerOutputV1, WorkerOutputRejection> {
        match outcome {
            EnvelopeOutcome::Recognised(r) => r,
            EnvelopeOutcome::NotEnvelope => panic!("expected Recognised, got NotEnvelope"),
        }
    }

    #[test]
    fn plain_array_is_not_envelope() {
        let v = json!([{"title": "x"}]);
        assert!(matches!(
            validate_worker_output(&v),
            EnvelopeOutcome::NotEnvelope
        ));
    }

    #[test]
    fn legacy_object_without_schema_version_is_not_envelope() {
        let v = json!({"candidates": [{"title": "x"}]});
        assert!(matches!(
            validate_worker_output(&v),
            EnvelopeOutcome::NotEnvelope
        ));
    }

    #[test]
    fn happy_path_v1_envelope() {
        let v = json!({
            "schema_version": 1,
            "swarm": "rtd",
            "agent_role": "assessment-worker",
            "candidates": [
                {"title": "Missing TLS", "severity": "high", "category": "security"}
            ]
        });
        let parsed = unwrap_recognised(validate_worker_output(&v)).expect("ok");
        assert_eq!(parsed.schema_version, 1);
        assert_eq!(parsed.swarm.as_deref(), Some("rtd"));
        assert_eq!(parsed.candidates.len(), 1);
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let v = json!({"schema_version": 99, "candidates": []});
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "schema_version_unsupported");
        assert_eq!(rej.reason, "schema_version_unsupported");
        assert_eq!(rej.path.as_deref(), Some("schema_version"));
    }

    #[test]
    fn rejects_non_integer_schema_version() {
        let v = json!({"schema_version": "1", "candidates": []});
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "schema_version_invalid");
        assert_eq!(rej.reason, "schema_invalid");
    }

    #[test]
    fn rejects_missing_candidates() {
        let v = json!({"schema_version": 1});
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "missing_candidates");
        assert_eq!(rej.reason, "schema_invalid");
    }

    #[test]
    fn rejects_candidates_not_array() {
        let v = json!({"schema_version": 1, "candidates": {"title": "x"}});
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "candidates_not_array");
        assert_eq!(rej.reason, "schema_invalid");
    }

    #[test]
    fn rejects_candidate_missing_title() {
        let v = json!({
            "schema_version": 1,
            "candidates": [{"title": "ok"}, {"severity": "low"}]
        });
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "candidate_missing_title");
        assert_eq!(rej.reason, "candidate_schema_invalid");
        assert_eq!(rej.path.as_deref(), Some("candidates[1].title"));
    }

    #[test]
    fn rejects_candidate_invalid_severity() {
        let v = json!({
            "schema_version": 1,
            "candidates": [{"title": "x", "severity": "catastrophic"}]
        });
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "candidate_severity_invalid");
        assert_eq!(rej.reason, "candidate_schema_invalid");
        assert!(rej.path.as_deref().unwrap().ends_with(".severity"));
    }

    #[test]
    fn rejects_empty_null_schema_version_as_empty_output() {
        let v = json!({"schema_version": null});
        let rej = unwrap_recognised(validate_worker_output(&v)).unwrap_err();
        assert_eq!(rej.code, "empty_output");
        assert_eq!(rej.reason, "empty_output");
    }

    #[test]
    fn empty_candidates_array_is_valid() {
        let v = json!({"schema_version": 1, "candidates": []});
        let parsed = unwrap_recognised(validate_worker_output(&v)).unwrap();
        assert!(parsed.candidates.is_empty());
    }

    #[test]
    fn event_payload_includes_path_and_code() {
        let rej = WorkerOutputRejection::new(
            "schema_version_unsupported",
            "schema_version_unsupported",
            "unsupported",
        )
        .at("schema_version");
        let p = rej.to_event_payload("run-1");
        assert_eq!(p["run_id"], "run-1");
        assert_eq!(p["reason"], "schema_version_unsupported");
        assert_eq!(p["code"], "schema_version_unsupported");
        assert_eq!(p["path"], "schema_version");
    }
}
