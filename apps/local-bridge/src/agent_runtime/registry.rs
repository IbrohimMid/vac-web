//! AgentRuntimeRegistry — resolves the active agent for a session spawn.
//!
//! Stage X.1: lookup is read-only and decided at bridge startup. There
//! is no per-session `agent_id` on the wire yet (X.4 lands that). The
//! registry exposes `default_agent` + `get` so future stages can plug
//! in user selection without touching SessionRegistry.

use super::config::{
    AgentDefinition, AgentKind, AgentsConfig, DEFAULT_PERMISSION_TIMEOUT_MS, EMBEDDED_DEFAULT_TOML,
};
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

    /// Resolve config from env → XDG → home → embedded default.
    ///
    /// `VAC_WEB_AGENTS_CONFIG` is treated as an *explicit* operator
    /// intent: if it's set, the path **must** exist and parse, else
    /// `load()` errors. The lower-priority `VAC_CONFIG_DIR/agents.toml`
    /// and `~/.config/vac-web/agents.toml` lookups remain best-effort:
    /// missing files fall through to the next source.
    pub fn load() -> Result<Self> {
        if let Some(p) = std::env::var_os("VAC_WEB_AGENTS_CONFIG") {
            let path = PathBuf::from(p);
            return Self::load_from_path(&path).map(|cfg| Self {
                config: cfg,
                source: ConfigSource::EnvFile(path),
            });
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

/// Infer the [`AgentKind`] for a legacy single-binary engine path.
///
/// Used by the back-compat synth path (`VAC_ENGINE_BIN` override and
/// `SessionRegistry::new(PathBuf)` shim). Looks at the binary's file
/// name: `mock-engine` → `Mock`, anything else → `VacNative`.
///
/// Accuracy matters because Stage X.2 will enforce
/// `allowed_agent_kinds` per profile — misclassifying mock-engine as
/// vac-native would let policy decisions fire on the wrong kind.
pub fn infer_legacy_agent_kind(command: &Path) -> AgentKind {
    let file = command
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if file == "mock-engine" || file.contains("mock-engine") {
        AgentKind::Mock
    } else {
        AgentKind::VacNative
    }
}

/// Build a one-agent [`AgentRuntimeRegistry`] around a raw binary path.
///
/// Single source of truth for the back-compat synth used by both
/// `main.rs` (when `VAC_ENGINE_BIN` is set or no agents.toml is found)
/// and `SessionRegistry::new(PathBuf)`. Centralizing avoids drift in
/// `kind` / `args` / timeout / source between call sites.
pub fn synth_legacy_registry(engine_bin: PathBuf) -> AgentRuntimeRegistry {
    let id = "default".to_string();
    let kind = infer_legacy_agent_kind(&engine_bin);
    let agent = AgentDefinition {
        id: id.clone(),
        label: "Default engine".into(),
        kind,
        command: engine_bin,
        args: vec!["--stdio".into()],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
        install_hint: None,
    };
    let cfg = AgentsConfig {
        default_agent_id: id,
        agents: vec![agent],
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}

fn home_config_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("vac-web").join("agents.toml")
}

/// Stage X.5e — PATH-based install detection used to flag agents whose
/// `command` binary isn't present on the host so the cockpit can show
/// an "install needed" badge + hint instead of letting the user pick an
/// agent that will fail at session spawn time.
///
/// - Absolute or path-prefixed commands (e.g. `./tools/foo`,
///   `/usr/local/bin/foo`) are checked directly: file must exist and be
///   executable.
/// - Bare names (e.g. `npx`, `gemini`) are looked up in `PATH` using
///   [`std::env::split_paths`] so we honour the user's shell setup.
/// - The function never spawns the binary; it's a metadata probe only.
pub fn is_command_installed(command: &Path) -> bool {
    let s = command.to_string_lossy();
    if s.is_empty() {
        return false;
    }
    let has_separator =
        s.contains('/') || s.contains('\\') || s.starts_with('.') || command.is_absolute();
    if has_separator {
        return is_executable_file(command);
    }
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(command);
        if is_executable_file(&candidate) {
            return true;
        }
    }
    false
}

#[cfg(unix)]
fn is_executable_file(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(p) {
        Ok(m) => m.is_file() && (m.permissions().mode() & 0o111 != 0),
        Err(_) => false,
    }
}

#[cfg(not(unix))]
fn is_executable_file(p: &Path) -> bool {
    p.is_file()
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
    fn explicit_env_config_missing_errors() {
        let _g = isolated_env();
        std::env::set_var(
            "VAC_WEB_AGENTS_CONFIG",
            "/definitely/missing/agents-x1-test.toml",
        );
        let err = AgentRuntimeRegistry::load().unwrap_err();
        assert!(
            matches!(err, AgentRuntimeError::Read { .. }),
            "expected Read error, got {err:?}"
        );
    }

    #[test]
    fn infer_kind_classifies_mock_engine_as_mock() {
        assert_eq!(
            infer_legacy_agent_kind(Path::new("/usr/bin/mock-engine")),
            AgentKind::Mock
        );
        assert_eq!(
            infer_legacy_agent_kind(Path::new("./target/debug/mock-engine")),
            AgentKind::Mock
        );
    }

    #[test]
    fn infer_kind_classifies_vac_as_vac_native() {
        assert_eq!(
            infer_legacy_agent_kind(Path::new("/usr/local/bin/vac")),
            AgentKind::VacNative
        );
        assert_eq!(
            infer_legacy_agent_kind(Path::new("vac")),
            AgentKind::VacNative
        );
    }

    #[test]
    fn synth_legacy_uses_inferred_kind() {
        let mock = synth_legacy_registry(PathBuf::from("/path/to/mock-engine"));
        assert_eq!(mock.default_agent().kind, AgentKind::Mock);
        let native = synth_legacy_registry(PathBuf::from("/path/to/vac"));
        assert_eq!(native.default_agent().kind, AgentKind::VacNative);
    }

    #[test]
    fn is_command_installed_finds_sh_on_path() {
        // `sh` is on PATH on every supported dev/CI environment (Linux,
        // macOS). Use it as the canary that PATH lookup actually works.
        // Skip if PATH is missing for some reason.
        if std::env::var_os("PATH").is_none() {
            return;
        }
        assert!(
            is_command_installed(Path::new("sh")),
            "sh must be on PATH for this test machine"
        );
    }

    #[test]
    fn is_command_installed_rejects_unknown_bare_name() {
        let _g = isolated_env();
        // Use a name that cannot plausibly exist anywhere on PATH.
        assert!(!is_command_installed(Path::new(
            "definitely-not-installed-binary-xyz-9f8a"
        )));
    }

    #[test]
    fn is_command_installed_handles_absolute_path() {
        // /bin/sh is a hard guarantee on every Unix dev box. On Windows
        // this would skip via cfg(unix), but our CI is Linux/macOS.
        if !Path::new("/bin/sh").exists() {
            return;
        }
        assert!(is_command_installed(Path::new("/bin/sh")));
        assert!(!is_command_installed(Path::new(
            "/definitely/missing/path/abc-no-such-thing"
        )));
    }

    #[test]
    fn is_command_installed_rejects_empty() {
        assert!(!is_command_installed(Path::new("")));
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
