//! Slice 41 — bridge structured log emitter.
//!
//! Builds a JSON object that conforms to `schema/observability-events.yaml`.
//! Every entry carries the catalog-required keys (`event`, `session_id`,
//! `actor`, `severity`, `code`, `latency_ms`); optional keys are added
//! lazily and validated at construction time.
//!
//! The emitter is decoupled from the audit writer so test code can build
//! entries without spinning up an `AuditWriter`. Production code routes
//! finished entries through `AuditFacility::log` (or any sink that takes
//! a `serde_json::Value`).
//!
//! See `docs/observability.md` for the operator-facing rationale and
//! SLO contract.

#![allow(dead_code)]

use serde_json::{json, Map, Value};
use std::fmt;

/// Stable severity ladder. Maps 1:1 to the
/// `required_keys[severity].values` enum in
/// `schema/observability-events.yaml`.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum LogSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

impl LogSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
            Self::Critical => "critical",
        }
    }
}

impl fmt::Display for LogSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Who initiated the action. Mirrors the schema enum for the `actor`
/// required key.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum LogActor {
    User,
    Agent,
    System,
}

impl LogActor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::System => "system",
        }
    }
}

impl fmt::Display for LogActor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Reasons a candidate entry can fail validation. Returned by
/// [`StructuredLogBuilder::build`] when the entry would not satisfy the
/// schema.
#[derive(Debug, PartialEq, Eq)]
pub enum LogValidationError {
    EventEmpty,
    EventInvalid(String),
    OptionalKeyEmpty(&'static str),
    NamespacedKeyForbiddenPrefix(String),
    NamespacedKeyConflict(String),
}

impl fmt::Display for LogValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EventEmpty => f.write_str("event id must not be empty"),
            Self::EventInvalid(id) => write!(
                f,
                "event id {id:?} must be lowercase snake.case with at least one '.'"
            ),
            Self::OptionalKeyEmpty(name) => write!(f, "optional key {name} cannot be empty"),
            Self::NamespacedKeyForbiddenPrefix(name) => write!(
                f,
                "namespaced key {name:?} does not match an allowed prefix; add an ADR + update schema/observability-events.yaml"
            ),
            Self::NamespacedKeyConflict(name) => write!(
                f,
                "namespaced key {name:?} collides with a top-level required/optional key"
            ),
        }
    }
}

impl std::error::Error for LogValidationError {}

/// Allowed namespace prefixes; mirrors the `allowed_namespace_prefixes`
/// list in `schema/observability-events.yaml`. Adding to this list
/// requires an ADR.
///
/// Slice 41 (Pass #22) extension: `approval.`, `agent.`, `session.` added to
/// stop forcing these domains to masquerade under `profile.*`. The mini-ADR
/// rationale is formalized in `docs/adr/0002-observability-namespace-extension.md`.
const ALLOWED_NAMESPACE_PREFIXES: &[&str] = &[
    "audit.",
    "persistence.",
    "workflow.",
    "shell.",
    "mcp.",
    "registry.",
    "profile.",
    "release.",
    "handoff.",
    "pairing.",
    "ws.",
    "approval.",
    "agent.",
    "session.",
    "extensions.",
];

/// Required + optional keys are reserved at the top level. Namespaced
/// keys may not collide with these names.
const RESERVED_TOP_LEVEL_KEYS: &[&str] = &[
    "event",
    "session_id",
    "actor",
    "severity",
    "code",
    "latency_ms",
    "command_id",
    "profile_id",
    "job_id",
    "correlation_id",
];

/// Builder for a structured log entry. Fluent API; call [`build`] to
/// produce the validated JSON object.
///
/// [`build`]: StructuredLogBuilder::build
#[derive(Debug, Clone)]
pub struct StructuredLogBuilder {
    event: String,
    session_id: Option<String>,
    actor: LogActor,
    severity: LogSeverity,
    code: String,
    latency_ms: Option<f64>,
    command_id: Option<String>,
    profile_id: Option<String>,
    job_id: Option<String>,
    correlation_id: Option<String>,
    namespaced: Map<String, Value>,
}

impl StructuredLogBuilder {
    /// Start a new builder. `event` must be a catalog event id (e.g.
    /// `session.started`); validation is deferred to [`build`] so
    /// callers can chain modifiers.
    pub fn new(event: impl Into<String>, actor: LogActor, severity: LogSeverity) -> Self {
        Self {
            event: event.into(),
            session_id: None,
            actor,
            severity,
            code: String::new(),
            latency_ms: None,
            command_id: None,
            profile_id: None,
            job_id: None,
            correlation_id: None,
            namespaced: Map::new(),
        }
    }

    /// Slice 41 audit-adapter accessor: severity used to map to
    /// `bridge_core::AuditSeverity` when the entry is routed through
    /// the audit facility.
    pub fn severity_for_audit(&self) -> LogSeverity {
        self.severity
    }

    /// Slice 41 audit-adapter accessor: session id used to address the
    /// audit shard when the entry is routed through the audit
    /// facility. Falls back to `"_sessionless"` when no session is set
    /// so audit reads never see an empty key.
    pub fn session_id_for_audit(&self) -> &str {
        self.session_id.as_deref().unwrap_or("_sessionless")
    }

    pub fn session_id(mut self, value: impl Into<String>) -> Self {
        self.session_id = Some(value.into());
        self
    }

    pub fn no_session(mut self) -> Self {
        self.session_id = None;
        self
    }

    pub fn code(mut self, value: impl Into<String>) -> Self {
        self.code = value.into();
        self
    }

    pub fn latency_ms(mut self, value: f64) -> Self {
        self.latency_ms = Some(value);
        self
    }

    pub fn command_id(mut self, value: impl Into<String>) -> Self {
        self.command_id = Some(value.into());
        self
    }

    pub fn profile_id(mut self, value: impl Into<String>) -> Self {
        self.profile_id = Some(value.into());
        self
    }

    pub fn job_id(mut self, value: impl Into<String>) -> Self {
        self.job_id = Some(value.into());
        self
    }

    pub fn correlation_id(mut self, value: impl Into<String>) -> Self {
        self.correlation_id = Some(value.into());
        self
    }

    /// Add a namespaced key (e.g. `persistence.dropped`). The key must
    /// start with one of the allowed prefixes from the schema and must
    /// not collide with a reserved top-level key name.
    pub fn namespaced(
        mut self,
        key: impl Into<String>,
        value: impl Into<Value>,
    ) -> Result<Self, LogValidationError> {
        let key = key.into();
        validate_namespaced_key(&key)?;
        self.namespaced.insert(key, value.into());
        Ok(self)
    }

    /// Validate the entry and produce the final JSON object.
    pub fn build(self) -> Result<Value, LogValidationError> {
        validate_event_id(&self.event)?;

        if let Some(cmd) = self.command_id.as_deref() {
            if cmd.is_empty() {
                return Err(LogValidationError::OptionalKeyEmpty("command_id"));
            }
        }
        if let Some(p) = self.profile_id.as_deref() {
            if p.is_empty() {
                return Err(LogValidationError::OptionalKeyEmpty("profile_id"));
            }
        }
        if let Some(j) = self.job_id.as_deref() {
            if j.is_empty() {
                return Err(LogValidationError::OptionalKeyEmpty("job_id"));
            }
        }
        if let Some(c) = self.correlation_id.as_deref() {
            if c.is_empty() {
                return Err(LogValidationError::OptionalKeyEmpty("correlation_id"));
            }
        }

        let mut obj = Map::new();
        obj.insert("event".into(), Value::String(self.event));
        obj.insert(
            "session_id".into(),
            self.session_id.map(Value::String).unwrap_or(Value::Null),
        );
        obj.insert("actor".into(), Value::String(self.actor.to_string()));
        obj.insert("severity".into(), Value::String(self.severity.to_string()));
        obj.insert("code".into(), Value::String(self.code));
        obj.insert(
            "latency_ms".into(),
            match self.latency_ms {
                Some(v) => json!(v),
                None => Value::Null,
            },
        );
        if let Some(v) = self.command_id {
            obj.insert("command_id".into(), Value::String(v));
        }
        if let Some(v) = self.profile_id {
            obj.insert("profile_id".into(), Value::String(v));
        }
        if let Some(v) = self.job_id {
            obj.insert("job_id".into(), Value::String(v));
        }
        if let Some(v) = self.correlation_id {
            obj.insert("correlation_id".into(), Value::String(v));
        }
        for (k, v) in self.namespaced {
            obj.insert(k, v);
        }

        Ok(Value::Object(obj))
    }
}

fn validate_event_id(id: &str) -> Result<(), LogValidationError> {
    if id.is_empty() {
        return Err(LogValidationError::EventEmpty);
    }
    if !id.contains('.') {
        return Err(LogValidationError::EventInvalid(id.to_string()));
    }
    for ch in id.chars() {
        if !(ch.is_ascii_lowercase() || ch == '.' || ch == '_' || ch.is_ascii_digit()) {
            return Err(LogValidationError::EventInvalid(id.to_string()));
        }
    }
    Ok(())
}

fn validate_namespaced_key(name: &str) -> Result<(), LogValidationError> {
    if RESERVED_TOP_LEVEL_KEYS.contains(&name) {
        return Err(LogValidationError::NamespacedKeyConflict(name.to_string()));
    }
    if !ALLOWED_NAMESPACE_PREFIXES
        .iter()
        .any(|p| name.starts_with(p))
    {
        return Err(LogValidationError::NamespacedKeyForbiddenPrefix(
            name.to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_minimal_required_keys() {
        let v = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Info)
            .session_id("sess_01")
            .build()
            .unwrap();
        let o = v.as_object().unwrap();
        assert_eq!(o.get("event").unwrap(), "session.started");
        assert_eq!(o.get("session_id").unwrap(), "sess_01");
        assert_eq!(o.get("actor").unwrap(), "user");
        assert_eq!(o.get("severity").unwrap(), "info");
        assert_eq!(o.get("code").unwrap(), "");
        assert!(o.get("latency_ms").unwrap().is_null());
    }

    #[test]
    fn null_session_id_is_acceptable() {
        let v = StructuredLogBuilder::new("session.closed", LogActor::System, LogSeverity::Info)
            .build()
            .unwrap();
        assert!(v.as_object().unwrap().get("session_id").unwrap().is_null());
    }

    #[test]
    fn rejects_empty_event_id() {
        let err = StructuredLogBuilder::new("", LogActor::User, LogSeverity::Info)
            .build()
            .unwrap_err();
        assert_eq!(err, LogValidationError::EventEmpty);
    }

    #[test]
    fn rejects_event_id_without_namespace() {
        let err = StructuredLogBuilder::new("started", LogActor::User, LogSeverity::Info)
            .build()
            .unwrap_err();
        assert_eq!(err, LogValidationError::EventInvalid("started".to_string()));
    }

    #[test]
    fn rejects_event_id_with_invalid_chars() {
        let err = StructuredLogBuilder::new("Session.Started", LogActor::User, LogSeverity::Info)
            .build()
            .unwrap_err();
        assert!(matches!(err, LogValidationError::EventInvalid(_)));
    }

    #[test]
    fn accepts_allowed_namespaced_key() {
        let v = StructuredLogBuilder::new("workflow.started", LogActor::Agent, LogSeverity::Info)
            .namespaced("workflow.step_id", json!("build"))
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            v.as_object().unwrap().get("workflow.step_id").unwrap(),
            "build"
        );
    }

    #[test]
    fn rejects_forbidden_prefix() {
        let err = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Info)
            .namespaced("telemetry.foo", json!(1))
            .unwrap_err();
        assert!(matches!(
            err,
            LogValidationError::NamespacedKeyForbiddenPrefix(_)
        ));
    }

    #[test]
    fn rejects_namespaced_collision_with_reserved_top_level() {
        let err = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Info)
            .namespaced("profile_id", json!("x"))
            .unwrap_err();
        assert!(matches!(err, LogValidationError::NamespacedKeyConflict(_)));
    }

    #[test]
    fn rejects_empty_optional_keys() {
        let err = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Info)
            .command_id("")
            .build()
            .unwrap_err();
        assert_eq!(err, LogValidationError::OptionalKeyEmpty("command_id"));
    }

    #[test]
    fn full_entry_round_trips_through_json() {
        let v = StructuredLogBuilder::new(
            "workflow.step.completed",
            LogActor::Agent,
            LogSeverity::Warning,
        )
        .session_id("sess_01")
        .code("step_partial")
        .latency_ms(123.4)
        .command_id("workflow.advance")
        .profile_id("executor.code@1.0.0")
        .job_id("job_42")
        .correlation_id("corr_01")
        .namespaced("workflow.step_id", json!("build"))
        .unwrap()
        .namespaced("persistence.bytes_written", json!(1024))
        .unwrap()
        .build()
        .unwrap();
        let s = serde_json::to_string(&v).unwrap();
        let back: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(back, v);
        let o = back.as_object().unwrap();
        assert_eq!(o.get("workflow.step_id").unwrap(), "build");
        assert_eq!(o.get("persistence.bytes_written").unwrap(), 1024);
    }

    /// Schema-parity guard: every prefix advertised by the schema YAML
    /// is recognised by the emitter, and every prefix the emitter
    /// allows is documented in the schema. Reading the YAML at test
    /// time keeps the two sources of truth in lock-step.
    #[test]
    fn allowed_prefixes_match_schema_yaml() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schema/observability-events.yaml");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        let value: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let prefixes = value
            .get("allowed_namespace_prefixes")
            .and_then(|v| v.as_sequence())
            .expect("allowed_namespace_prefixes missing in schema");
        let from_schema: std::collections::BTreeSet<String> = prefixes
            .iter()
            .map(|v| v.as_str().expect("prefix is string").to_string())
            .collect();
        let from_code: std::collections::BTreeSet<String> = ALLOWED_NAMESPACE_PREFIXES
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            from_schema, from_code,
            "emitter ALLOWED_NAMESPACE_PREFIXES is out of sync with schema/observability-events.yaml"
        );
    }

    /// Ensure every required and optional key declared in the schema
    /// has a corresponding builder method (by name).
    #[test]
    fn reserved_top_level_keys_match_schema_yaml() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schema/observability-events.yaml");
        let raw = std::fs::read_to_string(&path).unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let collect = |key: &str| -> std::collections::BTreeSet<String> {
            value
                .get(key)
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|item| {
                            item.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut from_schema = collect("required_keys");
        from_schema.extend(collect("optional_keys"));
        let from_code: std::collections::BTreeSet<String> = RESERVED_TOP_LEVEL_KEYS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            from_schema, from_code,
            "emitter RESERVED_TOP_LEVEL_KEYS is out of sync with schema/observability-events.yaml"
        );
    }

    // Slice 41 audit-adapter accessors used by `audit::log_structured`.
    #[test]
    fn audit_accessor_returns_severity() {
        let b = StructuredLogBuilder::new("session.started", LogActor::User, LogSeverity::Warning)
            .session_id("s_1")
            .code("ok")
            .latency_ms(0.0);
        assert_eq!(b.severity_for_audit(), LogSeverity::Warning);
        assert_eq!(b.session_id_for_audit(), "s_1");
    }

    #[test]
    fn audit_accessor_falls_back_to_sessionless() {
        let b = StructuredLogBuilder::new("session.started", LogActor::System, LogSeverity::Info)
            .no_session()
            .code("ok")
            .latency_ms(0.0);
        assert_eq!(b.session_id_for_audit(), "_sessionless");
    }
}
