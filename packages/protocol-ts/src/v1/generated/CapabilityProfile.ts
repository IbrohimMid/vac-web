// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/capability_profile.schema.json

export interface CapabilityProfile {
  allowed_agent_kinds?: 'mock' | 'vac-native' | 'acp'[];
  approval_required_for: string[];
  audit?: CapabilityProfileAudit;
  class: 'assessor' | 'executor';
  connectors: CapabilityProfileConnectors;
  description?: string;
  fs: CapabilityProfileFs;
  git: CapabilityProfileGit;
  id: string;
  inherits_from?: string;
  network_egress: CapabilityProfileNetworkEgress;
  require_dry_run_first?: boolean;
  require_maintenance_window?: boolean;
  require_reversibility_proof?: boolean;
  required_signers?: number;
  resource_limits?: CapabilityProfileResourceLimits;
  shell_allowlist: CapabilityProfileShellAllowlist[];
  tool_allow: string[];
  tool_deny: string[];
  version: string;
}

export interface CapabilityProfileAudit {
  log_every_tool_call?: boolean;
  log_tool_args?: 'full' | 'redacted' | 'none';
  retain_for_days?: number;
  subsystem_tag?: string;
}

export interface CapabilityProfileConnectors {
  read?: string[];
  write?: string[];
}

export interface CapabilityProfileFs {
  deny_globs?: string[];
  docs_roots?: string[];
  max_bytes_per_read?: number;
  max_bytes_per_write?: number;
  read?: 'none' | 'project_root' | 'project_and_docs';
  scoped_paths?: string[];
  write?: 'none' | 'project_root' | 'scoped_paths';
}

export interface CapabilityProfileGit {
  branch?: boolean;
  commit?: boolean;
  protected_refs?: string[];
  push?: boolean;
  push_remotes_allow?: string[];
  read?: boolean;
  tag?: boolean;
}

export interface CapabilityProfileNetworkEgress {
  host_allowlist?: string[];
  methods_allow?: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'[];
  mode?: 'off' | 'allowlist' | 'unrestricted';
}

export interface CapabilityProfileResourceLimits {
  max_concurrent_children?: number;
  max_session_wallclock_ms?: number;
  max_tool_calls?: number;
}

export interface CapabilityProfileShellAllowlist {
  args_pattern?: string;
  bin: string;
  cwd_scope?: 'project_root' | 'project_root_subtree' | 'tempdir';
  env_allowlist?: string[];
  max_args?: number;
  output_cap_bytes?: number;
  timeout_ms?: number;
}
