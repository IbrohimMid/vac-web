//! Stage R3 — session-resume policy normalizer.
//!
//! Two-step pipeline:
//!   YAML  --serde-->  RawResumePolicy  --normalize-->  SessionResumePolicy
//!
//! `RawResumePolicy` is intentionally forgiving: every field is
//! optional, every enum is a `String`. That keeps the deserializer
//! tolerant of unknown / future fields so the bridge never refuses
//! to start over a typo.
//!
//! `normalize` is where we get strict: unknown enum values, out-of-range
//! numbers, and non-string types all emit typed [`Diagnostic`]s. If at
//! least one diagnostic has severity `Error` we return `Err(diags)` and
//! the caller falls back to `SessionResumePolicy::default()` instead
//! of swapping in a half-broken policy.
//!
//! The Rust runtime is the only enforcement point. The schema at
//! `schema/config/session-resume.schema.json` exists so authors get
//! an editor warning before the bridge even starts; it is NOT
//! consulted at runtime.

use serde::{Deserialize, Serialize};

// -- defaults exposed as constants so call-sites and tests share them.

/// Default retention if YAML omits the field. 30 days matches what
/// every dev-loop session list shows today.
pub const DEFAULT_RETENTION_DAYS: u32 = 30;

/// Default per-session event ceiling. 20k is the same number
/// `PersistenceConfig` has used since Phase 3.
pub const DEFAULT_MAX_EVENTS: u32 = 20_000;

// -- normalized (strict) types ---------------------------------------------

/// Strict resume mode picker. Mirrors the three modes the translator
/// already understands; we never expose a 4th here — YAML cannot
/// invent runtime behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResumeDefaultMode {
    ReplayOnly,
    AcpLoad,
    NativeOrReplay,
}

impl ResumeDefaultMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResumeDefaultMode::ReplayOnly => "replay_only",
            ResumeDefaultMode::AcpLoad => "acp_load",
            ResumeDefaultMode::NativeOrReplay => "native_or_replay",
        }
    }
}

/// What `native_or_replay` should do when the live agent doesn't
/// advertise loadSession.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeFallbackPolicy {
    /// Today's behavior — silently downshift to persistence replay.
    ReplayOnly,
    /// Make the unsupported case explicit with a hard fail.
    Fail,
}

impl NativeFallbackPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            NativeFallbackPolicy::ReplayOnly => "replay_only",
            NativeFallbackPolicy::Fail => "fail",
        }
    }
}

/// What to do when persisted MCP servers differ from the live agent
/// registry advertisement at resume time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpDriftPolicy {
    /// Emit `session.resume.warning reason=mcp_server_drift` and continue.
    Warn,
    /// Emit `session.resume.failed reason=mcp_server_drift`.
    Fail,
    /// Suppress the event entirely.
    Ignore,
}

impl McpDriftPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpDriftPolicy::Warn => "warn",
            McpDriftPolicy::Fail => "fail",
            McpDriftPolicy::Ignore => "ignore",
        }
    }
}

/// What to do when persisted vs live `profile_class` differ. Stage
/// R2 hard-coded `Fail`; R3 keeps that as the default but encodes
/// the choice as a policy so a future relaxed mode is one config
/// flip away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileClassPolicy {
    Fail,
    Warn,
}

impl ProfileClassPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProfileClassPolicy::Fail => "fail",
            ProfileClassPolicy::Warn => "warn",
        }
    }
}

/// Strict runtime resume policy. This is the only struct the
/// translator + persistence consult.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionResumePolicy {
    pub default_mode: ResumeDefaultMode,
    pub native_fallback: NativeFallbackPolicy,
    pub mcp_server_drift: McpDriftPolicy,
    pub profile_class_mismatch: ProfileClassPolicy,
    pub retention_days: u32,
    pub max_events: u32,
}

impl Default for SessionResumePolicy {
    /// Defaults match what the bridge did before R3 existed:
    ///   * native_or_replay (matches new default in shipped YAML)
    ///   * silent fallback to replay
    ///   * warn on MCP drift
    ///   * fail on profile class mismatch (R2 contract)
    ///   * 30-day retention, 20k events
    fn default() -> Self {
        Self {
            default_mode: ResumeDefaultMode::NativeOrReplay,
            native_fallback: NativeFallbackPolicy::ReplayOnly,
            mcp_server_drift: McpDriftPolicy::Warn,
            profile_class_mismatch: ProfileClassPolicy::Fail,
            retention_days: DEFAULT_RETENTION_DAYS,
            max_events: DEFAULT_MAX_EVENTS,
        }
    }
}

// -- raw (forgiving) types -------------------------------------------------

/// Top-level raw shape. We deserialize the whole file even if only
/// `session_resume` is interesting today — R4 will add sibling keys.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawResumePolicy {
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub session_resume: Option<RawSessionResumeBlock>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawSessionResumeBlock {
    #[serde(default)]
    pub default_mode: Option<String>,
    #[serde(default)]
    pub native_fallback: Option<String>,
    #[serde(default)]
    pub mcp_server_drift: Option<String>,
    #[serde(default)]
    pub profile_class_mismatch: Option<String>,
    #[serde(default)]
    pub retention_days: Option<i64>,
    #[serde(default)]
    pub max_events: Option<i64>,
}

// -- diagnostics -----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

/// Structured diagnostic. R4 will reuse this shape for the cross-file
/// config loader; for now it's confined to resume policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub scope: String,
    pub path: String,
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn err(scope: &str, path: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            scope: scope.into(),
            path: path.into(),
            severity: DiagnosticSeverity::Error,
            code: code.into(),
            message: message.into(),
        }
    }
}

// -- public API ------------------------------------------------------------

impl RawResumePolicy {
    /// Parse a YAML file body. Wraps `serde_yaml::Error` as a single
    /// `schema_invalid` diagnostic so callers don't have to special
    /// case the parse step.
    pub fn from_yaml(body: &str) -> Result<Self, Vec<Diagnostic>> {
        match serde_yaml::from_str::<RawResumePolicy>(body) {
            Ok(raw) => Ok(raw),
            Err(e) => Err(vec![Diagnostic::err(
                "session_resume",
                "config/sessions/resume-policy.yaml",
                "schema_invalid",
                format!("yaml parse failed: {e}"),
            )]),
        }
    }

    /// Strict pass: unknown enum values + out-of-range numbers become
    /// errors. Missing fields fall back to `SessionResumePolicy::default()`
    /// fields silently — the schema gate already nags on missing
    /// required keys at lint time, and at runtime we always want a
    /// usable policy.
    pub fn normalize(self) -> Result<SessionResumePolicy, Vec<Diagnostic>> {
        const SCOPE: &str = "session_resume";
        const PATH: &str = "config/sessions/resume-policy.yaml";
        let mut diags: Vec<Diagnostic> = Vec::new();
        let mut policy = SessionResumePolicy::default();

        let block = self.session_resume.unwrap_or_default();

        if let Some(s) = block.default_mode.as_deref() {
            match s {
                "replay_only" => policy.default_mode = ResumeDefaultMode::ReplayOnly,
                "acp_load" => policy.default_mode = ResumeDefaultMode::AcpLoad,
                "native_or_replay" => policy.default_mode = ResumeDefaultMode::NativeOrReplay,
                other => diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "unknown_enum_value",
                    format!(
                        "session_resume.default_mode: unknown value `{other}` (expected replay_only|acp_load|native_or_replay)"
                    ),
                )),
            }
        }
        if let Some(s) = block.native_fallback.as_deref() {
            match s {
                "replay_only" => policy.native_fallback = NativeFallbackPolicy::ReplayOnly,
                "fail" => policy.native_fallback = NativeFallbackPolicy::Fail,
                other => diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "unknown_enum_value",
                    format!(
                        "session_resume.native_fallback: unknown value `{other}` (expected replay_only|fail)"
                    ),
                )),
            }
        }
        if let Some(s) = block.mcp_server_drift.as_deref() {
            match s {
                "warn" => policy.mcp_server_drift = McpDriftPolicy::Warn,
                "fail" => policy.mcp_server_drift = McpDriftPolicy::Fail,
                "ignore" => policy.mcp_server_drift = McpDriftPolicy::Ignore,
                other => diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "unknown_enum_value",
                    format!(
                        "session_resume.mcp_server_drift: unknown value `{other}` (expected warn|fail|ignore)"
                    ),
                )),
            }
        }
        if let Some(s) = block.profile_class_mismatch.as_deref() {
            match s {
                "fail" => policy.profile_class_mismatch = ProfileClassPolicy::Fail,
                "warn" => policy.profile_class_mismatch = ProfileClassPolicy::Warn,
                other => diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "unknown_enum_value",
                    format!(
                        "session_resume.profile_class_mismatch: unknown value `{other}` (expected fail|warn)"
                    ),
                )),
            }
        }
        if let Some(n) = block.retention_days {
            if !(1..=3650).contains(&n) {
                diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "out_of_range",
                    format!("session_resume.retention_days: {n} not in [1, 3650]"),
                ));
            } else {
                policy.retention_days = n as u32;
            }
        }
        if let Some(n) = block.max_events {
            if n < 1 {
                diags.push(Diagnostic::err(
                    SCOPE,
                    PATH,
                    "out_of_range",
                    format!("session_resume.max_events: {n} must be >= 1"),
                ));
            } else {
                policy.max_events = n as u32;
            }
        }

        if diags
            .iter()
            .any(|d| matches!(d.severity, DiagnosticSeverity::Error))
        {
            Err(diags)
        } else {
            Ok(policy)
        }
    }
}

/// Convenience: load + normalize from a path. Missing file is *not*
/// an error — it returns the default policy plus a warning-style
/// trace, so a fresh checkout boots without YAML.
pub fn load_from_path(path: &std::path::Path) -> Result<SessionResumePolicy, Vec<Diagnostic>> {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SessionResumePolicy::default());
        }
        Err(e) => {
            return Err(vec![Diagnostic::err(
                "session_resume",
                &path.display().to_string(),
                "io_error",
                format!("failed to read resume policy: {e}"),
            )]);
        }
    };
    let raw = RawResumePolicy::from_yaml(&body)?;
    raw.normalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Empty input — every field falls back to runtime defaults
    /// without producing diagnostics.
    #[test]
    fn empty_yaml_yields_defaults() {
        let raw = RawResumePolicy::from_yaml("version: 1\n").unwrap();
        let normalized = raw.normalize().unwrap();
        assert_eq!(normalized, SessionResumePolicy::default());
    }

    /// Happy path: every enum + bound is exercised, including the
    /// non-default `Fail` variants for native fallback and drift so
    /// we know the wiring isn't accidentally hard-coded.
    #[test]
    fn full_yaml_round_trip() {
        let yaml = r#"
version: 1
session_resume:
  default_mode: acp_load
  native_fallback: fail
  mcp_server_drift: ignore
  profile_class_mismatch: warn
  retention_days: 90
  max_events: 50000
"#;
        let p = RawResumePolicy::from_yaml(yaml)
            .unwrap()
            .normalize()
            .unwrap();
        assert_eq!(p.default_mode, ResumeDefaultMode::AcpLoad);
        assert_eq!(p.native_fallback, NativeFallbackPolicy::Fail);
        assert_eq!(p.mcp_server_drift, McpDriftPolicy::Ignore);
        assert_eq!(p.profile_class_mismatch, ProfileClassPolicy::Warn);
        assert_eq!(p.retention_days, 90);
        assert_eq!(p.max_events, 50_000);
    }

    /// Unknown enum value is rejected without falling back — the
    /// caller (loader) will keep the previous snapshot.
    #[test]
    fn unknown_enum_value_emits_error_diag() {
        let yaml = r#"
version: 1
session_resume:
  default_mode: yolo
"#;
        let raw = RawResumePolicy::from_yaml(yaml).unwrap();
        let err = raw.normalize().expect_err("unknown enum should error");
        assert_eq!(err.len(), 1);
        assert_eq!(err[0].code, "unknown_enum_value");
        assert_eq!(err[0].severity, DiagnosticSeverity::Error);
        assert!(err[0].message.contains("default_mode"));
    }

    /// retention_days outside [1, 3650] is rejected.
    #[test]
    fn retention_days_out_of_range() {
        let yaml = r#"
version: 1
session_resume:
  retention_days: 0
"#;
        let err = RawResumePolicy::from_yaml(yaml)
            .unwrap()
            .normalize()
            .unwrap_err();
        assert_eq!(err[0].code, "out_of_range");
        assert!(err[0].message.contains("retention_days"));
    }

    /// Bad YAML at the parser level becomes a `schema_invalid` diag.
    #[test]
    fn malformed_yaml_returns_schema_invalid() {
        let err = RawResumePolicy::from_yaml("::: not yaml :::\n\n[\n").unwrap_err();
        assert!(matches!(err[0].severity, DiagnosticSeverity::Error));
        assert_eq!(err[0].code, "schema_invalid");
    }

    /// Multiple errors in one file all surface, not just the first.
    #[test]
    fn multiple_errors_accumulate() {
        let yaml = r#"
version: 1
session_resume:
  default_mode: yolo
  native_fallback: maybe
  retention_days: 99999
"#;
        let err = RawResumePolicy::from_yaml(yaml)
            .unwrap()
            .normalize()
            .unwrap_err();
        assert_eq!(err.len(), 3);
    }

    /// Missing file path returns the default policy without an error
    /// so a fresh checkout boots cleanly.
    #[test]
    fn missing_file_uses_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let p = load_from_path(&tmp.path().join("nope.yaml")).unwrap();
        assert_eq!(p, SessionResumePolicy::default());
    }
}
