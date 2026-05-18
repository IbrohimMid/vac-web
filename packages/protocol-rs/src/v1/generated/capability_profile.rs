// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/capability_profile.schema.json

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_agent_kinds: Option<Vec<String>>,
    pub approval_required_for: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit: Option<CapabilityProfileAudit>,
    pub class: String,
    pub connectors: CapabilityProfileConnectors,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub fs: CapabilityProfileFs,
    pub git: CapabilityProfileGit,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherits_from: Option<String>,
    pub network_egress: CapabilityProfileNetworkEgress,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_dry_run_first: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_maintenance_window: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_reversibility_proof: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_signers: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_limits: Option<CapabilityProfileResourceLimits>,
    pub shell_allowlist: Vec<CapabilityProfileShellAllowlist>,
    pub tool_allow: Vec<String>,
    pub tool_deny: Vec<String>,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileAudit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_every_tool_call: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_tool_args: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retain_for_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subsystem_tag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileConnectors {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileFs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny_globs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_roots: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes_per_read: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes_per_write: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scoped_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileGit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_refs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_remotes_allow: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileNetworkEgress {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_allowlist: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub methods_allow: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileResourceLimits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_concurrent_children: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_session_wallclock_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tool_calls: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityProfileShellAllowlist {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_pattern: Option<String>,
    pub bin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_allowlist: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_args: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_cap_bytes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
}
