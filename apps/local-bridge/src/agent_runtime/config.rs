//! Agent runtime config types + parser.
//!
//! Stage X.1 scope: types, validation, embedded default. ACP kind is
//! parseable but no real ACP driver yet (X.3 lands that). No browser-
//! facing protocol field, no UI picker.

use super::errors::{AgentRuntimeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Minimum permission timeout. ACP modal-halt prompts can take a human
/// a while to respond; anything below 10s is almost certainly a typo.
pub const MIN_PERMISSION_TIMEOUT_MS: u64 = 10_000;

/// Default permission timeout used by the embedded mock and any agent
/// that doesn't specify one. Matches `agent-runtime.md` design lock.
pub const DEFAULT_PERMISSION_TIMEOUT_MS: u64 = 300_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    /// In-repo mock-engine binary; default for tests + dev.
    Mock,
    /// `vac` CLI from the vastar-agentic-cli repo.
    VacNative,
    /// ACP-compatible CLI (Claude Code, OpenCode, Codex). Stage X.1
    /// parses + lists these but does not spawn them yet.
    Acp,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentKind::Mock => "mock",
            AgentKind::VacNative => "vac-native",
            AgentKind::Acp => "acp",
        }
    }
}

/// Resolved, validated agent definition.
#[derive(Debug, Clone)]
pub struct AgentDefinition {
    pub id: String,
    pub label: String,
    pub kind: AgentKind,
    pub command: PathBuf,
    pub args: Vec<String>,
    pub enabled: bool,
    pub permission_timeout_ms: u64,
}

/// Raw on-disk shape (toml). Kept separate from `AgentDefinition` so
/// parse errors carry the source path, and so we can validate before
/// promoting into the runtime registry.
#[derive(Debug, Deserialize)]
struct AgentsFileRaw {
    #[serde(default)]
    default_agent: Option<String>,
    #[serde(default)]
    agents: BTreeMap<String, AgentEntryRaw>,
}

#[derive(Debug, Deserialize)]
struct AgentEntryRaw {
    kind: String,
    #[serde(default)]
    label: Option<String>,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    permission_timeout_ms: Option<u64>,
}

fn default_enabled() -> bool {
    true
}

/// Parsed config: `default_agent` resolved, every agent validated.
#[derive(Debug, Clone)]
pub struct AgentsConfig {
    pub default_agent_id: String,
    pub agents: Vec<AgentDefinition>,
}

impl AgentsConfig {
    /// Parse + validate a TOML config string. `source_path` is used
    /// for error messages only; pass a sentinel like `<embedded>` for
    /// the built-in default.
    pub fn from_toml_str(src: &str, source_path: &Path) -> Result<Self> {
        let raw: AgentsFileRaw = toml::from_str(src).map_err(|e| AgentRuntimeError::Parse {
            path: source_path.to_path_buf(),
            message: e.to_string(),
        })?;
        Self::from_raw(raw, source_path)
    }

    fn from_raw(raw: AgentsFileRaw, source_path: &Path) -> Result<Self> {
        if raw.agents.is_empty() {
            return Err(AgentRuntimeError::Parse {
                path: source_path.to_path_buf(),
                message: "no [agents.*] tables defined".into(),
            });
        }

        let mut seen = std::collections::BTreeSet::new();
        let mut agents = Vec::with_capacity(raw.agents.len());
        for (id, entry) in raw.agents {
            validate_id(&id)?;
            if !seen.insert(id.clone()) {
                return Err(AgentRuntimeError::DuplicateId { id });
            }
            let kind = match entry.kind.as_str() {
                "mock" => AgentKind::Mock,
                "vac-native" => AgentKind::VacNative,
                "acp" => AgentKind::Acp,
                other => {
                    return Err(AgentRuntimeError::UnknownKind {
                        path: source_path.to_path_buf(),
                        id,
                        kind: other.to_string(),
                    });
                }
            };
            if entry.command.trim().is_empty() {
                return Err(AgentRuntimeError::EmptyCommand { id });
            }
            let permission_timeout_ms = entry
                .permission_timeout_ms
                .unwrap_or(DEFAULT_PERMISSION_TIMEOUT_MS);
            if permission_timeout_ms < MIN_PERMISSION_TIMEOUT_MS {
                return Err(AgentRuntimeError::PermissionTimeoutTooLow {
                    id,
                    value: permission_timeout_ms,
                    min: MIN_PERMISSION_TIMEOUT_MS,
                });
            }
            let label = entry.label.unwrap_or_else(|| id.clone());
            agents.push(AgentDefinition {
                id,
                label,
                kind,
                command: PathBuf::from(entry.command),
                args: entry.args,
                enabled: entry.enabled,
                permission_timeout_ms,
            });
        }

        let any_enabled = agents.iter().any(|a| a.enabled);
        if !any_enabled {
            return Err(AgentRuntimeError::NoEnabledAgents);
        }

        let default_agent_id = match raw.default_agent {
            Some(id) => id,
            None => agents
                .iter()
                .find(|a| a.enabled)
                .map(|a| a.id.clone())
                .expect("any_enabled checked above"),
        };

        let default_def = agents
            .iter()
            .find(|a| a.id == default_agent_id)
            .ok_or_else(|| AgentRuntimeError::DefaultMissing {
                id: default_agent_id.clone(),
            })?;
        if !default_def.enabled {
            return Err(AgentRuntimeError::DefaultDisabled {
                id: default_agent_id,
            });
        }

        Ok(AgentsConfig {
            default_agent_id,
            agents,
        })
    }
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(AgentRuntimeError::InvalidId { id: id.to_string() });
    }
    Ok(())
}

/// Embedded default config — used when no `agents.toml` is present
/// anywhere in the lookup order. Mock-only, mirrors current behavior.
pub const EMBEDDED_DEFAULT_TOML: &str = r#"
default_agent = "mock"

[agents.mock]
kind = "mock"
label = "Mock Engine"
command = "mock-engine"
args = ["--stdio"]
enabled = true
permission_timeout_ms = 300000
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn embedded() -> AgentsConfig {
        AgentsConfig::from_toml_str(EMBEDDED_DEFAULT_TOML, Path::new("<embedded>")).unwrap()
    }

    #[test]
    fn embedded_default_parses_to_mock() {
        let cfg = embedded();
        assert_eq!(cfg.default_agent_id, "mock");
        assert_eq!(cfg.agents.len(), 1);
        let a = &cfg.agents[0];
        assert_eq!(a.kind, AgentKind::Mock);
        assert!(a.enabled);
        assert_eq!(a.args, vec!["--stdio".to_string()]);
    }

    #[test]
    fn parses_acp_kind_without_implementing_it() {
        let src = r#"
default_agent = "claude"

[agents.claude]
kind = "acp"
command = "claude"
args = ["--acp"]
enabled = true
permission_timeout_ms = 300000
"#;
        let cfg = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap();
        assert_eq!(cfg.agents[0].kind, AgentKind::Acp);
    }

    #[test]
    fn rejects_unknown_kind() {
        let src = r#"
[agents.bad]
kind = "wat"
command = "x"
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::UnknownKind { .. }));
    }

    #[test]
    fn rejects_empty_command() {
        let src = r#"
[agents.bad]
kind = "mock"
command = ""
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::EmptyCommand { .. }));
    }

    #[test]
    fn rejects_low_permission_timeout() {
        let src = r#"
[agents.fast]
kind = "mock"
command = "mock-engine"
permission_timeout_ms = 500
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(
            err,
            AgentRuntimeError::PermissionTimeoutTooLow { .. }
        ));
    }

    #[test]
    fn rejects_default_missing() {
        let src = r#"
default_agent = "ghost"

[agents.real]
kind = "mock"
command = "mock-engine"
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::DefaultMissing { .. }));
    }

    #[test]
    fn rejects_default_disabled() {
        let src = r#"
default_agent = "off"

[agents.off]
kind = "mock"
command = "mock-engine"
enabled = false

[agents.on]
kind = "mock"
command = "mock-engine"
enabled = true
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::DefaultDisabled { .. }));
    }

    #[test]
    fn rejects_no_enabled_agents() {
        let src = r#"
[agents.a]
kind = "mock"
command = "x"
enabled = false
"#;
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::NoEnabledAgents));
    }

    #[test]
    fn rejects_invalid_id() {
        let src = r#"
[agents."WeirdID"]
kind = "mock"
command = "x"
"#;
        // Note: TOML keys with quotes still must satisfy our id rules.
        let err = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap_err();
        assert!(matches!(err, AgentRuntimeError::InvalidId { .. }));
    }

    #[test]
    fn no_default_agent_picks_first_enabled() {
        let src = r#"
[agents.b]
kind = "mock"
command = "x"

[agents.a]
kind = "mock"
command = "x"
"#;
        // BTreeMap orders alphabetically → "a" wins.
        let cfg = AgentsConfig::from_toml_str(src, Path::new("test")).unwrap();
        assert_eq!(cfg.default_agent_id, "a");
    }
}
