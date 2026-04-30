//! Stage R4 — control-plane root loader.
//!
//! Walks `config/vac.yaml`, resolves the three child files we currently
//! validate (agents/registry, mcp/servers, sessions/resume-policy), and
//! produces a `ConfigSnapshot` plus a typed diagnostic stream. The
//! Rust runtime is the only thing that ever mutates registry/MCP/
//! resume state — the snapshot here is a *preview surface* + the
//! source of truth for resume-policy enforcement (R3).
//!
//! Safe-reload contract:
//!   1. Read every YAML.
//!   2. Schema/serde-validate each into its `Raw*` shape.
//!   3. Normalize into runtime structs.
//!   4. Build a candidate `ConfigSnapshot`.
//!   5. Caller swaps the live `Arc<RwLock<ConfigSnapshot>>` only on
//!      success. On failure the previous snapshot stays installed.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::resume_policy::{self, Diagnostic, DiagnosticSeverity, SessionResumePolicy};

// ----- raw shapes (forgiving) ------------------------------------------------
//
// We deliberately keep these `Raw*` shapes loose: serde_yaml parses
// them, the AJV gate in `pnpm schema:validate` enforces strictness.
// Runtime code only ever sees the normalized summaries below; many
// of the optional fields below aren't surfaced in the snapshot yet,
// but we still want serde_yaml to fail on typos via
// `deny_unknown_fields`, so silencing dead_code on the structs is
// the cleanest option until the snapshot grows richer.

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawVacRoot {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    imports: Option<RawVacImports>,
}

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawVacImports {
    #[serde(default)]
    agents_registry: Option<String>,
    #[serde(default)]
    mcp_servers: Option<String>,
    #[serde(default)]
    session_resume: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAgentRegistry {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    agents: Vec<RawAgentEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAgentEntry {
    id: String,
    #[serde(default)]
    label: Option<String>,
    kind: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    env: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    capabilities_profile: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    default: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMcpServers {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    servers: Vec<RawMcpServer>,
}

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMcpServer {
    id: String,
    #[serde(default)]
    label: Option<String>,
    transport: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    auth: Option<serde_yaml::Value>,
    #[serde(default)]
    enabled: Option<bool>,
}

// ----- normalized summaries (runtime + preview) ------------------------------

/// Compact summary the frontend renders in its preview panel. The
/// real agent registry is owned by `agent_runtime`; this is a
/// declarative shadow used for surface display only.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AgentRegistrySummary {
    pub version: u32,
    pub count: usize,
    pub default_id: Option<String>,
    /// First N entries (id + kind) for the preview panel. Capped to
    /// avoid blowing up payloads on workspaces with hundreds of
    /// agents declared.
    pub agents: Vec<AgentRegistryItem>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AgentRegistryItem {
    pub id: String,
    pub kind: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct McpServersSummary {
    pub version: u32,
    pub count: usize,
    pub servers: Vec<McpServerItem>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct McpServerItem {
    pub id: String,
    pub transport: String,
    pub enabled: bool,
}

/// What the WS surface sees at any given moment. Held behind
/// `Arc<RwLock<...>>` so reload is safe.
#[derive(Debug, Clone)]
pub struct ConfigSnapshot {
    /// True when every config file in the snapshot validated and
    /// normalized cleanly. False after a failed reload — in that
    /// case the live snapshot is still the previous one and `ok`
    /// flips back to true on the next successful reload.
    pub ok: bool,
    pub loaded_at: String,
    /// Resume policy is the only config piece the runtime actually
    /// enforces today; the rest are preview-only.
    pub resume_policy: SessionResumePolicy,
    pub agents: AgentRegistrySummary,
    pub mcp: McpServersSummary,
    pub vac_version: u32,
    /// Captured warnings + (in failed-reload reports) errors.
    /// Errors never appear in a *successful* snapshot; the loader
    /// returns them via `LoadOutcome::Failed` instead.
    pub diagnostics: Vec<Diagnostic>,
    /// True after a reload failed while a previous valid snapshot is still installed.
    pub active_snapshot_retained: bool,
    /// Timestamp of the latest failed reload, when `active_snapshot_retained` is true.
    pub last_reload_failed_at: Option<String>,
}

impl Default for ConfigSnapshot {
    fn default() -> Self {
        Self {
            ok: true,
            loaded_at: chrono::Utc::now().to_rfc3339(),
            resume_policy: SessionResumePolicy::default(),
            agents: AgentRegistrySummary::default(),
            mcp: McpServersSummary::default(),
            vac_version: 0,
            diagnostics: vec![],
            active_snapshot_retained: false,
            last_reload_failed_at: None,
        }
    }
}

/// Result of a load attempt. `Failed` keeps the diagnostics so the
/// translator can echo them back to the client; the previous live
/// snapshot remains installed.
#[derive(Debug, Clone)]
pub enum LoadOutcome {
    Loaded(ConfigSnapshot),
    Failed(Vec<Diagnostic>),
}

/// Locations the loader will read from. `root_dir` is the only
/// required input; child paths are resolved relative to it via
/// `vac.yaml`'s `imports` block (with sane defaults).
#[derive(Debug, Clone)]
pub struct LoaderPaths {
    pub root_dir: PathBuf,
}

impl LoaderPaths {
    pub fn from_env_or(default_root: impl Into<PathBuf>) -> Self {
        let root = std::env::var("VAC_CONFIG_DIR")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| default_root.into());
        Self { root_dir: root }
    }

    fn vac_yaml(&self) -> PathBuf {
        self.root_dir.join("vac.yaml")
    }
}

// ----- public entry points ----------------------------------------------------

/// Load + validate the entire config tree. Missing files fall back
/// to defaults rather than failing — a brand-new checkout boots.
pub fn load(paths: &LoaderPaths) -> LoadOutcome {
    let mut diags: Vec<Diagnostic> = Vec::new();

    // ----- vac.yaml (root) -----
    let (vac_version, imports) = match read_optional_yaml::<RawVacRoot>(&paths.vac_yaml(), "vac") {
        ReadResult::Ok(v) => (v.version, v.imports.unwrap_or_default()),
        ReadResult::Missing => (0, RawVacImports::default()),
        ReadResult::Err(e) => {
            diags.extend(e);
            (0, RawVacImports::default())
        }
    };

    // ----- agents/registry.yaml -----
    let agents_path = imports
        .agents_registry
        .as_deref()
        .map(|p| paths.root_dir.join(p))
        .unwrap_or_else(|| paths.root_dir.join("agents/registry.yaml"));
    let agents = match read_optional_yaml::<RawAgentRegistry>(&agents_path, "agents.registry") {
        ReadResult::Ok(raw) => normalize_agents(raw),
        ReadResult::Missing => AgentRegistrySummary::default(),
        ReadResult::Err(e) => {
            diags.extend(e);
            AgentRegistrySummary::default()
        }
    };

    // ----- mcp/servers.yaml -----
    let mcp_path = imports
        .mcp_servers
        .as_deref()
        .map(|p| paths.root_dir.join(p))
        .unwrap_or_else(|| paths.root_dir.join("mcp/servers.yaml"));
    let mcp = match read_optional_yaml::<RawMcpServers>(&mcp_path, "mcp.servers") {
        ReadResult::Ok(raw) => normalize_mcp(raw),
        ReadResult::Missing => McpServersSummary::default(),
        ReadResult::Err(e) => {
            diags.extend(e);
            McpServersSummary::default()
        }
    };

    // ----- sessions/resume-policy.yaml (the only policy the runtime enforces) -----
    let resume_path = imports
        .session_resume
        .as_deref()
        .map(|p| paths.root_dir.join(p))
        .unwrap_or_else(|| paths.root_dir.join("sessions/resume-policy.yaml"));
    let resume_policy = match resume_policy::load_from_path(&resume_path) {
        Ok(p) => p,
        Err(e) => {
            diags.extend(e);
            SessionResumePolicy::default()
        }
    };

    // Any *error*-severity diagnostic is a hard fail; warnings ride
    // along on the successful snapshot so the UI can surface them.
    let has_error = diags
        .iter()
        .any(|d| matches!(d.severity, DiagnosticSeverity::Error));
    if has_error {
        return LoadOutcome::Failed(diags);
    }

    LoadOutcome::Loaded(ConfigSnapshot {
        ok: true,
        loaded_at: chrono::Utc::now().to_rfc3339(),
        resume_policy,
        agents,
        mcp,
        vac_version,
        diagnostics: diags,
        active_snapshot_retained: false,
        last_reload_failed_at: None,
    })
}

// ----- internals --------------------------------------------------------------

enum ReadResult<T> {
    Ok(T),
    Missing,
    Err(Vec<Diagnostic>),
}

fn read_optional_yaml<T: for<'de> Deserialize<'de>>(path: &Path, scope: &str) -> ReadResult<T> {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ReadResult::Missing,
        Err(e) => {
            return ReadResult::Err(vec![Diagnostic::err(
                scope,
                &path.display().to_string(),
                "io_error",
                format!("failed to read: {e}"),
            )])
        }
    };
    match serde_yaml::from_str::<T>(&body) {
        Ok(v) => ReadResult::Ok(v),
        Err(e) => ReadResult::Err(vec![Diagnostic::err(
            scope,
            &path.display().to_string(),
            "schema_invalid",
            format!("yaml parse / shape error: {e}"),
        )]),
    }
}

fn normalize_agents(raw: RawAgentRegistry) -> AgentRegistrySummary {
    let mut default_id: Option<String> = None;
    let mut items: Vec<AgentRegistryItem> = Vec::with_capacity(raw.agents.len().min(32));
    for a in raw.agents.iter().take(32) {
        if a.default.unwrap_or(false) && default_id.is_none() {
            default_id = Some(a.id.clone());
        }
        items.push(AgentRegistryItem {
            id: a.id.clone(),
            kind: a.kind.clone(),
            enabled: a.enabled.unwrap_or(true),
        });
    }
    AgentRegistrySummary {
        version: raw.version,
        count: raw.agents.len(),
        default_id,
        agents: items,
    }
}

fn normalize_mcp(raw: RawMcpServers) -> McpServersSummary {
    let mut servers: Vec<McpServerItem> = Vec::with_capacity(raw.servers.len().min(32));
    for s in raw.servers.iter().take(32) {
        servers.push(McpServerItem {
            id: s.id.clone(),
            transport: s.transport.clone(),
            enabled: s.enabled.unwrap_or(true),
        });
    }
    McpServersSummary {
        version: raw.version,
        count: raw.servers.len(),
        servers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, body: &str) {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, body).unwrap();
    }

    #[test]
    fn missing_root_yields_defaults_with_no_diagnostics() {
        let tmp = tempdir().unwrap();
        let paths = LoaderPaths {
            root_dir: tmp.path().to_path_buf(),
        };
        let outcome = load(&paths);
        let snap = match outcome {
            LoadOutcome::Loaded(s) => s,
            LoadOutcome::Failed(d) => panic!("expected Loaded, got Failed: {d:?}"),
        };
        assert!(snap.ok);
        assert_eq!(snap.agents.count, 0);
        assert_eq!(snap.mcp.count, 0);
        assert!(snap.diagnostics.is_empty());
    }

    #[test]
    fn full_tree_loads_clean() {
        let tmp = tempdir().unwrap();
        write(tmp.path(), "vac.yaml", "version: 1\n");
        write(
            tmp.path(),
            "agents/registry.yaml",
            "version: 1\nagents:\n  - id: claude-code\n    kind: acp\n    default: true\n",
        );
        write(
            tmp.path(),
            "mcp/servers.yaml",
            "version: 1\nservers:\n  - id: vacweb\n    transport: streamable_http\n    url: https://example.invalid/mcp\n",
        );
        write(
            tmp.path(),
            "sessions/resume-policy.yaml",
            "version: 1\nsession_resume:\n  default_mode: replay_only\n  retention_days: 7\n  max_events: 100\n",
        );
        let paths = LoaderPaths {
            root_dir: tmp.path().to_path_buf(),
        };
        let snap = match load(&paths) {
            LoadOutcome::Loaded(s) => s,
            LoadOutcome::Failed(d) => panic!("unexpected failure: {d:?}"),
        };
        assert_eq!(snap.vac_version, 1);
        assert_eq!(snap.agents.count, 1);
        assert_eq!(snap.agents.default_id.as_deref(), Some("claude-code"));
        assert_eq!(snap.mcp.count, 1);
        assert_eq!(snap.resume_policy.retention_days, 7);
        assert_eq!(snap.resume_policy.max_events, 100);
    }

    #[test]
    fn malformed_child_yaml_marks_load_failed() {
        let tmp = tempdir().unwrap();
        write(tmp.path(), "vac.yaml", "version: 1\n");
        write(
            tmp.path(),
            "agents/registry.yaml",
            "this is not: [valid yaml",
        );
        let paths = LoaderPaths {
            root_dir: tmp.path().to_path_buf(),
        };
        match load(&paths) {
            LoadOutcome::Loaded(_) => panic!("expected Failed"),
            LoadOutcome::Failed(d) => {
                assert!(d.iter().any(|x| x.scope == "agents.registry"));
            }
        }
    }

    #[test]
    fn unknown_field_in_vac_root_is_an_error() {
        let tmp = tempdir().unwrap();
        write(tmp.path(), "vac.yaml", "version: 1\nnope: 42\n");
        let paths = LoaderPaths {
            root_dir: tmp.path().to_path_buf(),
        };
        match load(&paths) {
            LoadOutcome::Loaded(_) => panic!("expected Failed because of deny_unknown_fields"),
            LoadOutcome::Failed(d) => assert!(d.iter().any(|x| x.scope == "vac")),
        }
    }
}
