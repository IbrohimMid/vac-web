//! CapabilityProfile loader with `inherits_from` expansion.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    Assessor,
    Executor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityProfile {
    pub id: String,
    pub class: Class,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub inherits_from: Option<String>,

    #[serde(default)]
    pub tool_allow: Vec<String>,
    #[serde(default)]
    pub tool_deny: Vec<String>,

    #[serde(default)]
    pub shell_allowlist: Vec<ShellAllowEntry>,

    #[serde(default = "FsConfig::default")]
    pub fs: FsConfig,
    #[serde(default = "GitConfig::default")]
    pub git: GitConfig,
    #[serde(default = "ConnectorsConfig::default")]
    pub connectors: ConnectorsConfig,
    #[serde(default = "NetworkEgress::default")]
    pub network_egress: NetworkEgress,

    #[serde(default)]
    pub approval_required_for: Vec<String>,

    #[serde(default)]
    pub resource_limits: Option<ResourceLimits>,
    #[serde(default)]
    pub audit: Option<AuditConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellAllowEntry {
    pub bin: String,
    #[serde(default)]
    pub args_pattern: Option<String>,
    #[serde(default = "default_max_args")]
    pub max_args: usize,
    #[serde(default)]
    pub cwd_scope: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub env_allowlist: Vec<String>,
    #[serde(default = "default_output_cap_bytes")]
    pub output_cap_bytes: usize,
}
fn default_max_args() -> usize {
    32
}
fn default_timeout_ms() -> u64 {
    15_000
}
fn default_output_cap_bytes() -> usize {
    2_097_152
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsConfig {
    #[serde(default = "default_fs_read")]
    pub read: String,
    #[serde(default = "default_fs_write")]
    pub write: String,
    #[serde(default)]
    pub scoped_paths: Vec<String>,
    #[serde(default)]
    pub deny_globs: Vec<String>,
    #[serde(default = "default_max_read")]
    pub max_bytes_per_read: usize,
    #[serde(default)]
    pub max_bytes_per_write: usize,
}
fn default_fs_read() -> String {
    "project_root".into()
}
fn default_fs_write() -> String {
    "none".into()
}
fn default_max_read() -> usize {
    10_485_760
}
impl Default for FsConfig {
    fn default() -> Self {
        Self {
            read: default_fs_read(),
            write: default_fs_write(),
            scoped_paths: vec![],
            deny_globs: vec![],
            max_bytes_per_read: default_max_read(),
            max_bytes_per_write: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitConfig {
    #[serde(default = "yes")]
    pub read: bool,
    #[serde(default)]
    pub branch: bool,
    #[serde(default)]
    pub commit: bool,
    #[serde(default)]
    pub tag: bool,
    #[serde(default)]
    pub push: bool,
    #[serde(default)]
    pub push_remotes_allow: Vec<String>,
    #[serde(default)]
    pub protected_refs: Vec<String>,
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectorsConfig {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEgress {
    #[serde(default = "default_egress_mode")]
    pub mode: String,
    #[serde(default)]
    pub host_allowlist: Vec<String>,
    #[serde(default)]
    pub methods_allow: Vec<String>,
}
fn default_egress_mode() -> String {
    "allowlist".into()
}
impl Default for NetworkEgress {
    fn default() -> Self {
        Self {
            mode: default_egress_mode(),
            host_allowlist: vec![],
            methods_allow: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    #[serde(default)]
    pub max_session_wallclock_ms: Option<u64>,
    #[serde(default)]
    pub max_tool_calls: Option<u64>,
    #[serde(default)]
    pub max_concurrent_children: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditConfig {
    #[serde(default)]
    pub log_every_tool_call: Option<bool>,
    #[serde(default)]
    pub log_tool_args: Option<String>,
    #[serde(default)]
    pub retain_for_days: Option<u32>,
}

impl CapabilityProfile {
    /// Load a single profile YAML (no inheritance resolution).
    pub fn load_raw(path: impl AsRef<Path>) -> Result<Self> {
        let p = path.as_ref();
        let text =
            std::fs::read_to_string(p).with_context(|| format!("reading {}", p.display()))?;
        let prof: Self =
            serde_yaml::from_str(&text).with_context(|| format!("parsing {}", p.display()))?;
        Ok(prof)
    }

    /// Load + fully resolve inheritance. `profiles_dir` is the folder containing all YAMLs.
    pub fn load(id: &str, profiles_dir: impl AsRef<Path>) -> Result<Self> {
        let dir = profiles_dir.as_ref().to_path_buf();
        load_with_cache(id, &dir, &mut HashMap::new())
    }

    /// Sha256 of the raw YAML bytes of this profile id.
    pub fn raw_hash(id: &str, profiles_dir: impl AsRef<Path>) -> Result<String> {
        let path = profiles_dir.as_ref().join(format!("{id}.yaml"));
        crate::hash::sha256_file(&path)
    }
}

fn load_with_cache(
    id: &str,
    dir: &PathBuf,
    cache: &mut HashMap<String, CapabilityProfile>,
) -> Result<CapabilityProfile> {
    if let Some(p) = cache.get(id) {
        return Ok(p.clone());
    }
    let path = dir.join(format!("{id}.yaml"));
    let mut prof = CapabilityProfile::load_raw(&path)?;
    if let Some(parent_id) = prof.inherits_from.clone() {
        let parent = load_with_cache(&parent_id, dir, cache)?;
        prof = merge_with_parent(parent, prof)?;
    }
    validate_consistency(&prof)?;
    cache.insert(id.to_string(), prof.clone());
    Ok(prof)
}

fn merge_with_parent(
    parent: CapabilityProfile,
    child: CapabilityProfile,
) -> Result<CapabilityProfile> {
    // Invariant: child may add to connectors.read + network_egress.host_allowlist.
    // Child may NOT weaken parent (re-allow a denied tool, widen fs, enable git write, etc.).
    let mut out = parent;
    out.id = child.id;
    out.version = child.version;
    out.description = child.description.or(out.description);
    out.inherits_from = child.inherits_from;

    // Additive: tool_allow & tool_deny unions.
    for t in child.tool_allow {
        if !out.tool_allow.contains(&t) {
            out.tool_allow.push(t);
        }
    }
    for t in child.tool_deny {
        if !out.tool_deny.contains(&t) {
            out.tool_deny.push(t);
        }
    }

    // Shell allowlist: child ADDS only (cannot broaden parent's args_pattern).
    for e in child.shell_allowlist {
        if !out.shell_allowlist.iter().any(|x| x.bin == e.bin) {
            out.shell_allowlist.push(e);
        }
    }

    // fs: child may only narrow (can't change write none → write, can't remove deny_globs).
    if child.fs.read != default_fs_read() && !child.fs.read.is_empty() {
        // parent already set floor; child write must match or be stricter
        if child.fs.write != default_fs_write() && out.fs.write == default_fs_write() {
            bail!("child profile may not enable fs.write when parent denied");
        }
        out.fs.read = child.fs.read;
    }
    if !child.fs.deny_globs.is_empty() {
        for g in child.fs.deny_globs {
            if !out.fs.deny_globs.contains(&g) {
                out.fs.deny_globs.push(g);
            }
        }
    }

    // git: assessor profiles keep parent's strict setting.
    if out.class == Class::Assessor {
        // child cannot enable any git write flag
        for (parent_val, child_val, name) in [
            (out.git.branch, child.git.branch, "branch"),
            (out.git.commit, child.git.commit, "commit"),
            (out.git.tag, child.git.tag, "tag"),
            (out.git.push, child.git.push, "push"),
        ] {
            if !parent_val && child_val {
                bail!("child assessor profile cannot enable git.{name}");
            }
        }
    } else {
        // executor: child overrides
        out.git = child.git;
    }

    // connectors: union reads; writes must not be added by assessor child.
    for c in child.connectors.read {
        if !out.connectors.read.contains(&c) {
            out.connectors.read.push(c);
        }
    }
    if !child.connectors.write.is_empty() {
        if out.class == Class::Assessor {
            bail!("child assessor profile cannot declare connector writes");
        }
        out.connectors.write = child.connectors.write;
    }

    // network_egress: union host_allowlist; mode/methods from child if set.
    if !child.network_egress.host_allowlist.is_empty() {
        for h in child.network_egress.host_allowlist {
            if !out.network_egress.host_allowlist.contains(&h) {
                out.network_egress.host_allowlist.push(h);
            }
        }
    }
    if !child.network_egress.methods_allow.is_empty() {
        out.network_egress.methods_allow = child.network_egress.methods_allow;
    }

    // approval_required_for: union
    for a in child.approval_required_for {
        if !out.approval_required_for.contains(&a) {
            out.approval_required_for.push(a);
        }
    }

    Ok(out)
}

fn validate_consistency(p: &CapabilityProfile) -> Result<()> {
    if p.class == Class::Assessor {
        if p.fs.write != "none" {
            bail!(
                "assessor profile {} has fs.write={}, must be 'none'",
                p.id,
                p.fs.write
            );
        }
        if p.git.commit || p.git.push || p.git.tag || p.git.branch {
            bail!("assessor profile {} has a git write flag set", p.id);
        }
        if !p.connectors.write.is_empty() {
            bail!("assessor profile {} declares connector writes", p.id);
        }
    }
    Ok(())
}
