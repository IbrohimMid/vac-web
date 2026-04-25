//! AgentRuntimeRegistry — resolves the active agent for a session spawn.
//!
//! Stage X.1: lookup is read-only and decided at bridge startup. There
//! is no per-session `agent_id` on the wire yet (X.4 lands that). The
//! registry exposes `default_agent` + `get` so future stages can plug
//! in user selection without touching SessionRegistry.

use super::config::{AgentDefinition, AgentsConfig, EMBEDDED_DEFAULT_TOML};
use super::errors::{AgentRuntimeError, Result};
use std::path::{Path, PathBuf};
use tracing::info;

/// Source identifier for the loaded config — useful in logs and errors.
#[derive(Debug, Clone)]
pub enum ConfigSource {
    EnvFile(PathBuf),
    XdgConfig(PathBuf),
    HomeConfig(PathBuf),
    Embedded,
}

impl ConfigSource {
    pub fn describe(&self) -> String {
        match self {
            ConfigSource::EnvFile(p) => format!("env:{}", p.display()),
            ConfigSource::XdgConfig(p) => format!("xdg:{}", p.display()),
            ConfigSource::HomeConfig(p) => format!("home:{}", p.display()),
            ConfigSource::Embedded => "embedded".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentRuntimeRegistry {
    config: AgentsConfig,
    source: ConfigSource,
}

impl AgentRuntimeRegistry {
    /// Construct a registry from a parsed `AgentsConfig`. Used by tests
    /// and by the synthesizing back-compat shim on `SessionRegistry`.
    pub fn from_config(config: AgentsConfig, source: ConfigSource) -> Self {
        Self { config, source }
    }

    /// Resolve config from env → XDG → home → embedded default. Each
    /// step is tried in order; the first existing path wins. Missing
    /// files are skipped silently; *parse* errors short-circuit.
    pub fn load() -> Result<Self> {
        if let Some(p) = std::env::var_os("VAC_WEB_AGENTS_CONFIG") {
            let path = PathBuf::from(p);
            if path.exists() {
                return Self::load_from_path(&path).map(|cfg| Self {
                    config: cfg,
                    source: ConfigSource::EnvFile(path),
                });
            }
        }
        if let Some(dir) = std::env::var_os("VAC_CONFIG_DIR") {
            let path = PathBuf::from(dir).join("agents.toml");
            if path.exists() {
                return Self::load_from_path(&path).map(|cfg| Self {
                    config: cfg,
                    source: ConfigSource::XdgConfig(path),
                });
            }
        }
        let home_path = home_config_path();
        if home_path.exists() {
            return Self::load_from_path(&home_path).map(|cfg| Self {
                config: cfg,
                source: ConfigSource::HomeConfig(home_path),
            });
        }
        let embedded = AgentsConfig::from_toml_str(EMBEDDED_DEFAULT_TOML, Path::new("<embedded>"))
            .expect("embedded default config must always parse");
        Ok(Self {
            config: embedded,
            source: ConfigSource::Embedded,
        })
    }

    fn load_from_path(path: &Path) -> Result<AgentsConfig> {
        let src = std::fs::read_to_string(path).map_err(|e| AgentRuntimeError::Read {
            path: path.to_path_buf(),
            source: e,
        })?;
        AgentsConfig::from_toml_str(&src, path)
    }

    /// Default agent for this bridge — used by `SessionRegistry::create`
    /// until X.4 introduces a per-session selector.
    pub fn default_agent(&self) -> &AgentDefinition {
        self.config
            .agents
            .iter()
            .find(|a| a.id == self.config.default_agent_id)
            .expect("default_agent_id validated at parse time")
    }

    pub fn get(&self, id: &str) -> Result<&AgentDefinition> {
        self.config
            .agents
            .iter()
            .find(|a| a.id == id)
            .ok_or_else(|| AgentRuntimeError::NotFound { id: id.to_string() })
    }

    pub fn list_enabled(&self) -> Vec<&AgentDefinition> {
        self.config.agents.iter().filter(|a| a.enabled).collect()
    }

    pub fn source(&self) -> &ConfigSource {
        &self.source
    }

    /// Log a one-line startup summary so operators can see which
    /// driver kinds are wired without enabling debug logs.
    pub fn log_summary(&self) {
        let default = self.default_agent();
        let enabled: Vec<String> = self
            .list_enabled()
            .iter()
            .map(|a| format!("{}({})", a.id, a.kind.as_str()))
            .collect();
        info!(
            source = %self.source.describe(),
            default_agent = %default.id,
            default_kind = %default.kind.as_str(),
            enabled = %enabled.join(","),
            "agent runtime registry loaded"
        );
    }
}

fn home_config_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("vac-web").join("agents.toml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// Tests in this module mutate process-global env vars. Serialize
    /// them so cargo's parallel runner can't interleave guards.
    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    fn isolated_env() -> EnvGuard {
        EnvGuard::new()
    }

    /// RAII guard: holds the env mutex and snapshots/restores the env
    /// vars we touch so tests remain order-independent.
    struct EnvGuard {
        _lock: MutexGuard<'static, ()>,
        prev_env: Option<std::ffi::OsString>,
        prev_dir: Option<std::ffi::OsString>,
        prev_xdg: Option<std::ffi::OsString>,
        prev_home: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn new() -> Self {
            let lock = env_lock();
            let g = Self {
                _lock: lock,
                prev_env: std::env::var_os("VAC_WEB_AGENTS_CONFIG"),
                prev_dir: std::env::var_os("VAC_CONFIG_DIR"),
                prev_xdg: std::env::var_os("XDG_CONFIG_HOME"),
                prev_home: std::env::var_os("HOME"),
            };
            std::env::remove_var("VAC_WEB_AGENTS_CONFIG");
            std::env::remove_var("VAC_CONFIG_DIR");
            // Point HOME at a tempdir so the home lookup never finds a
            // real user file during test runs.
            let tmp = tempfile::tempdir().expect("tempdir");
            std::env::set_var("HOME", tmp.path());
            std::env::set_var("XDG_CONFIG_HOME", tmp.path());
            std::mem::forget(tmp);
            g
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            restore("VAC_WEB_AGENTS_CONFIG", &self.prev_env);
            restore("VAC_CONFIG_DIR", &self.prev_dir);
            restore("XDG_CONFIG_HOME", &self.prev_xdg);
            restore("HOME", &self.prev_home);
        }
    }

    fn restore(key: &str, val: &Option<std::ffi::OsString>) {
        match val {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn load_falls_back_to_embedded_when_no_files() {
        let _g = isolated_env();
        let reg = AgentRuntimeRegistry::load().unwrap();
        assert!(matches!(reg.source(), ConfigSource::Embedded));
        assert_eq!(reg.default_agent().id, "mock");
    }

    #[test]
    fn env_file_overrides_embedded() {
        let _g = isolated_env();
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            f,
            r#"
default_agent = "custom"

[agents.custom]
kind = "mock"
command = "custom-engine"
"#
        )
        .unwrap();
        std::env::set_var("VAC_WEB_AGENTS_CONFIG", f.path());
        let reg = AgentRuntimeRegistry::load().unwrap();
        assert_eq!(reg.default_agent().id, "custom");
        assert_eq!(reg.default_agent().command.to_str(), Some("custom-engine"));
    }

    #[test]
    fn get_unknown_agent_errors() {
        let _g = isolated_env();
        let reg = AgentRuntimeRegistry::load().unwrap();
        assert!(reg.get("ghost").is_err());
    }

    #[test]
    fn list_enabled_filters_disabled() {
        let _g = isolated_env();
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            f,
            r#"
default_agent = "on"

[agents.on]
kind = "mock"
command = "x"
enabled = true

[agents.off]
kind = "mock"
command = "x"
enabled = false
"#
        )
        .unwrap();
        std::env::set_var("VAC_WEB_AGENTS_CONFIG", f.path());
        let reg = AgentRuntimeRegistry::load().unwrap();
        let ids: Vec<&str> = reg.list_enabled().iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["on"]);
    }
}
