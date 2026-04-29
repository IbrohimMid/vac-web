//! Sprint 5 — fetch + parse remote/on-disk agent registries.
//!
//! The bridge already loads a *local* `agents.toml` at startup. Sprint 5
//! lets operators point at a *remote* (HTTP) or sibling on-disk catalog
//! of additional ACP adapters — same TOML shape — so the cockpit can
//! discover agents without a config edit + restart.
//!
//! Wire boundary: `registry.sync` returns the list of remote agents
//! merged against the local registry (local entries always win on `id`
//! collisions; remote entries get a `source: "remote"` marker so the
//! frontend can distinguish them and offer an install flow). The merge
//! is computed here; no on-disk mutation happens until the operator
//! explicitly calls `registry.add` (see `translator/mod.rs`).
//!
//! Caching: results are cached on disk under `<config_dir>/registry.cache.toml`
//! with the source TTL controlling staleness. A TTL of `0` disables
//! caching entirely (used by tests).

use super::config::{AgentsConfig, RegistrySource, RegistrySourceKind};
use super::registry::AgentRuntimeRegistry;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Wire-shape entry returned by `registry.sync`. Carries enough metadata
/// for the cockpit to render an install card (label, kind, install
/// hint) and to detect the `local` vs `remote` provenance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegistryEntry {
    pub id: String,
    pub label: String,
    /// Agent kind as a string — matches `AgentKind::as_str` (`mock`,
    /// `vac-native`, `acp`).
    pub kind: String,
    /// Command the bridge would spawn. Frontend treats this as opaque;
    /// only used in the install-confirmation card.
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Operator-supplied install/auth hint. Free-form one-liner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_hint: Option<String>,
    /// `local` when the entry already exists in the loaded `agents.toml`,
    /// `remote` when it came from the registry source. Used by the
    /// cockpit to decide whether to show a "Add to local" button.
    pub source: RegistryEntrySource,
    /// PATH-based install probe at sync time. Mirrors the welcome
    /// frame's per-agent `installed` flag so the cockpit can show the
    /// same badge.
    pub installed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RegistryEntrySource {
    Local,
    Remote,
}

/// Outcome of a single `registry.sync` invocation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RegistrySyncResult {
    /// Source kind (`url` / `path`) for telemetry / debugging.
    pub source_kind: &'static str,
    /// Raw `source` string from `[registry]` (URL or path as written).
    pub source: String,
    /// `true` when the result came from the on-disk cache instead of a
    /// live fetch. Useful for the frontend to surface a "cached" badge.
    pub from_cache: bool,
    /// Merged catalog: local agents first (in registry order), then
    /// remote-only agents.
    pub entries: Vec<RegistryEntry>,
}

/// Fetch + parse a registry source, returning the merged catalog.
///
/// `cache_dir`: directory used for the on-disk cache. Pass `None` to
/// disable caching (e.g. in tests). The cache file is named
/// `registry.cache.toml`.
pub async fn sync(
    source: &RegistrySource,
    registry: &AgentRuntimeRegistry,
    cache_dir: Option<&Path>,
) -> Result<RegistrySyncResult> {
    let (source_kind, raw_toml, from_cache) = load_source_with_cache(source, cache_dir).await?;

    let remote_agents =
        parse_remote_catalog(&raw_toml).context("failed to parse remote registry catalog")?;

    let entries = merge_local_remote(registry, remote_agents);

    Ok(RegistrySyncResult {
        source_kind,
        source: source.raw.clone(),
        from_cache,
        entries,
    })
}

async fn load_source_with_cache(
    source: &RegistrySource,
    cache_dir: Option<&Path>,
) -> Result<(&'static str, String, bool)> {
    // Try cache first when TTL > 0 and we have a writable cache dir.
    if source.cache_ttl_secs > 0 {
        if let Some(dir) = cache_dir {
            if let Some(cached) = read_cache(dir, source.cache_ttl_secs) {
                return Ok((source_kind_str(source), cached, true));
            }
        }
    }

    let body = match &source.kind {
        RegistrySourceKind::Url(url) => fetch_http(url).await?,
        RegistrySourceKind::Path(path) => std::fs::read_to_string(path)
            .with_context(|| format!("reading registry path {}", path.display()))?,
    };

    if source.cache_ttl_secs > 0 {
        if let Some(dir) = cache_dir {
            let _ = write_cache(dir, &body);
        }
    }

    Ok((source_kind_str(source), body, false))
}

fn source_kind_str(source: &RegistrySource) -> &'static str {
    match source.kind {
        RegistrySourceKind::Url(_) => "url",
        RegistrySourceKind::Path(_) => "path",
    }
}

async fn fetch_http(url: &str) -> Result<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!(
            "vac-web-bridge/",
            env!("CARGO_PKG_VERSION"),
            " (registry.sync)"
        ))
        .build()
        .context("building reqwest client")?;
    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        return Err(anyhow!(
            "registry source {url} returned HTTP {}",
            resp.status()
        ));
    }
    resp.text()
        .await
        .with_context(|| format!("reading body of {url}"))
}

#[derive(Debug, Deserialize)]
struct RemoteCatalog {
    #[serde(default)]
    agents: std::collections::BTreeMap<String, RemoteAgentEntry>,
}

#[derive(Debug, Deserialize)]
struct RemoteAgentEntry {
    kind: String,
    #[serde(default)]
    label: Option<String>,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    install_hint: Option<String>,
}

fn parse_remote_catalog(raw: &str) -> Result<Vec<RegistryEntry>> {
    let parsed: RemoteCatalog =
        toml::from_str(raw).context("remote registry must be valid TOML with [agents.*] tables")?;
    let mut out = Vec::with_capacity(parsed.agents.len());
    for (id, entry) in parsed.agents {
        if id.trim().is_empty() {
            continue;
        }
        if entry.command.trim().is_empty() {
            continue;
        }
        let label = entry.label.unwrap_or_else(|| id.clone());
        let installed = super::registry::is_command_installed(Path::new(&entry.command));
        out.push(RegistryEntry {
            id,
            label,
            kind: entry.kind,
            command: entry.command,
            args: entry.args,
            install_hint: entry.install_hint,
            source: RegistryEntrySource::Remote,
            installed,
        });
    }
    Ok(out)
}

fn merge_local_remote(
    registry: &AgentRuntimeRegistry,
    remote: Vec<RegistryEntry>,
) -> Vec<RegistryEntry> {
    let mut out: Vec<RegistryEntry> = registry
        .list_enabled()
        .into_iter()
        .map(|a| RegistryEntry {
            id: a.id.clone(),
            label: a.label.clone(),
            kind: a.kind.as_str().to_string(),
            command: a.command.to_string_lossy().into_owned(),
            args: a.args.clone(),
            install_hint: a.install_hint.clone(),
            source: RegistryEntrySource::Local,
            installed: super::registry::is_command_installed(&a.command),
        })
        .collect();
    let local_ids: std::collections::BTreeSet<String> = out.iter().map(|e| e.id.clone()).collect();
    for entry in remote {
        if local_ids.contains(&entry.id) {
            continue;
        }
        out.push(entry);
    }
    out
}

fn cache_path(dir: &Path) -> PathBuf {
    dir.join("registry.cache.toml")
}

fn read_cache(dir: &Path, ttl_secs: u64) -> Option<String> {
    let path = cache_path(dir);
    let meta = std::fs::metadata(&path).ok()?;
    let modified = meta.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age.as_secs() > ttl_secs {
        return None;
    }
    std::fs::read_to_string(&path).ok()
}

fn write_cache(dir: &Path, body: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(cache_path(dir), body)
}

/// Append a new agent entry to the on-disk `agents.toml` referenced by
/// the loaded config. Used by the `registry.add` WS command after the
/// operator clicks "Add to local" in the cockpit.
///
/// `target_path`: path of the loaded agents.toml. The file must exist;
/// the embedded default cannot be mutated (callers must error before
/// reaching here when `ConfigSource::Embedded`).
///
/// Idempotency: appending a duplicate `id` is a no-op (returns `false`)
/// so the cockpit can safely retry.
pub fn append_agent_to_config(
    target_path: &Path,
    entry: &RegistryEntry,
    existing: &AgentsConfig,
) -> Result<bool> {
    if existing.agents.iter().any(|a| a.id == entry.id) {
        return Ok(false);
    }
    let mut buf = String::new();
    if !target_path.exists() {
        return Err(anyhow!(
            "target config {} does not exist; refusing to create",
            target_path.display()
        ));
    }
    let current = std::fs::read_to_string(target_path)
        .with_context(|| format!("reading {}", target_path.display()))?;
    if !current.is_empty() && !current.ends_with('\n') {
        buf.push('\n');
    }
    buf.push_str(&render_agent_toml(entry));
    let mut combined = current;
    combined.push_str(&buf);
    // Validate the merged TOML before writing so we never leave the
    // operator's config in a broken state.
    AgentsConfig::from_toml_str(&combined, target_path)
        .context("merged config failed validation")?;
    std::fs::write(target_path, combined)
        .with_context(|| format!("writing {}", target_path.display()))?;
    Ok(true)
}

fn render_agent_toml(entry: &RegistryEntry) -> String {
    let mut s = format!(
        "\n[agents.{id}]\nkind = \"{kind}\"\n",
        id = entry.id,
        kind = entry.kind
    );
    s.push_str(&format!("label = {}\n", toml_quote(&entry.label)));
    s.push_str(&format!("command = {}\n", toml_quote(&entry.command)));
    if !entry.args.is_empty() {
        let parts: Vec<String> = entry.args.iter().map(|a| toml_quote(a)).collect();
        s.push_str(&format!("args = [{}]\n", parts.join(", ")));
    }
    s.push_str("enabled = true\n");
    if let Some(hint) = &entry.install_hint {
        s.push_str(&format!("install_hint = {}\n", toml_quote(hint)));
    }
    s
}

fn toml_quote(s: &str) -> String {
    // Conservative: always emit a basic-string with escaped backslashes
    // and quotes. Sufficient for command names and labels we control.
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::config::AgentsConfig;
    use crate::agent_runtime::registry::{AgentRuntimeRegistry, ConfigSource};
    use std::path::Path;

    fn registry_from(src: &str) -> AgentRuntimeRegistry {
        let cfg = AgentsConfig::from_toml_str(src, Path::new("<test>")).expect("parse");
        AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
    }

    #[test]
    fn parses_remote_catalog_and_marks_remote() {
        let raw = r#"
[agents.gemini-acp]
kind = "acp"
label = "Gemini"
command = "gemini"
args = ["--acp"]
install_hint = "npm i -g @google/gemini-cli"
"#;
        let entries = parse_remote_catalog(raw).expect("parse");
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.id, "gemini-acp");
        assert_eq!(e.kind, "acp");
        assert_eq!(e.command, "gemini");
        assert_eq!(e.args, vec!["--acp"]);
        assert_eq!(e.source, RegistryEntrySource::Remote);
        assert_eq!(
            e.install_hint.as_deref(),
            Some("npm i -g @google/gemini-cli")
        );
    }

    #[test]
    fn merge_keeps_local_first_and_dedupes_by_id() {
        let registry = registry_from(
            r#"
[agents.local-only]
kind = "mock"
command = "mock-engine"
"#,
        );
        let remote = vec![
            RegistryEntry {
                id: "local-only".into(),
                label: "Remote impostor".into(),
                kind: "acp".into(),
                command: "impostor".into(),
                args: vec![],
                install_hint: None,
                source: RegistryEntrySource::Remote,
                installed: false,
            },
            RegistryEntry {
                id: "new-acp".into(),
                label: "New ACP".into(),
                kind: "acp".into(),
                command: "new-acp".into(),
                args: vec!["--acp".into()],
                install_hint: None,
                source: RegistryEntrySource::Remote,
                installed: false,
            },
        ];
        let merged = merge_local_remote(&registry, remote);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "local-only");
        assert_eq!(merged[0].source, RegistryEntrySource::Local);
        // Local label wins, even though remote had a different label.
        assert_eq!(merged[0].label, "local-only");
        assert_eq!(merged[1].id, "new-acp");
        assert_eq!(merged[1].source, RegistryEntrySource::Remote);
    }

    #[test]
    fn append_agent_to_config_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("agents.toml");
        std::fs::write(
            &target,
            r#"
[agents.original]
kind = "mock"
command = "mock-engine"
"#,
        )
        .unwrap();
        let cfg = AgentsConfig::from_toml_str(&std::fs::read_to_string(&target).unwrap(), &target)
            .unwrap();
        let entry = RegistryEntry {
            id: "new-one".into(),
            label: "New Agent".into(),
            kind: "acp".into(),
            command: "new-cmd".into(),
            args: vec!["--acp".into()],
            install_hint: None,
            source: RegistryEntrySource::Remote,
            installed: false,
        };
        let added = append_agent_to_config(&target, &entry, &cfg).expect("append");
        assert!(added);
        let body = std::fs::read_to_string(&target).unwrap();
        assert!(body.contains("[agents.new-one]"), "body: {body}");
        // Re-parse and re-append should be a no-op.
        let cfg2 = AgentsConfig::from_toml_str(&body, &target).unwrap();
        let added_again = append_agent_to_config(&target, &entry, &cfg2).expect("append idem");
        assert!(!added_again);
    }

    #[test]
    fn append_rejects_invalid_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("agents.toml");
        std::fs::write(
            &target,
            r#"
[agents.original]
kind = "mock"
command = "mock-engine"
"#,
        )
        .unwrap();
        let cfg = AgentsConfig::from_toml_str(&std::fs::read_to_string(&target).unwrap(), &target)
            .unwrap();
        let entry = RegistryEntry {
            id: "BAD ID".into(),
            label: "x".into(),
            kind: "mock".into(),
            command: "x".into(),
            args: vec![],
            install_hint: None,
            source: RegistryEntrySource::Remote,
            installed: false,
        };
        let err = append_agent_to_config(&target, &entry, &cfg).unwrap_err();
        assert!(err.to_string().contains("merged config failed validation"));
    }
}
