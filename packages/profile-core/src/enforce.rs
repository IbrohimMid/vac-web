//! Layer 1 enforcement — pure functions over a loaded `CapabilityProfile`.

use crate::profile::CapabilityProfile;
use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::Regex;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny { reason: String, code: &'static str },
}

pub type EnforceResult = Decision;

impl Decision {
    pub fn allow() -> Self {
        Decision::Allow
    }
    pub fn deny(code: &'static str, reason: impl Into<String>) -> Self {
        Decision::Deny {
            reason: reason.into(),
            code,
        }
    }
    pub fn is_allow(&self) -> bool {
        matches!(self, Decision::Allow)
    }
    pub fn is_deny(&self) -> bool {
        !self.is_allow()
    }
}

/// Stage X.2: check whether an agent runtime kind is permitted to back
/// a session running this profile. Default-deny: an empty
/// `allowed_agent_kinds` list rejects every kind, so every shipped
/// profile must opt in explicitly to mock / vac-native / acp.
///
/// `kind` must already be a kebab-case canonical string (matching
/// `agent_runtime::AgentKind::as_str()`): one of "mock" | "vac-native"
/// | "acp". Anything else is denied with the same code so callers
/// don't need a separate path for typo'd kinds.
pub fn enforce_agent_kind(p: &CapabilityProfile, kind: &str) -> Decision {
    if p.allowed_agent_kinds.iter().any(|k| k == kind) {
        return Decision::allow();
    }
    Decision::deny(
        "agent.kind_not_allowed",
        format!(
            "agent kind '{kind}' is not in profile {}'s allowed_agent_kinds",
            p.id
        ),
    )
}

/// Check whether a tool name is permitted. Deny-wins semantics:
/// explicit deny match → deny; else allow-list match → allow; else deny.
pub fn enforce_tool(p: &CapabilityProfile, tool: &str) -> Decision {
    if matches_any(&p.tool_deny, tool) {
        return Decision::deny(
            "profile.tool_denied",
            format!("tool '{tool}' is in tool_deny"),
        );
    }
    if matches_any(&p.tool_allow, tool) {
        return Decision::allow();
    }
    Decision::deny(
        "profile.tool_not_allowed",
        format!("tool '{tool}' not in tool_allow"),
    )
}

/// Check shell invocation against the profile's allowlist.
pub fn enforce_shell(p: &CapabilityProfile, bin: &str, args: &[&str]) -> Decision {
    let entry = match p.shell_allowlist.iter().find(|e| e.bin == bin) {
        Some(e) => e,
        None => {
            return Decision::deny(
                "profile.shell_bin_not_allowed",
                format!("shell bin '{bin}' not in allowlist"),
            )
        }
    };
    if args.len() > entry.max_args {
        return Decision::deny(
            "profile.shell_too_many_args",
            format!("{} args exceeds max_args={}", args.len(), entry.max_args),
        );
    }
    if let Some(pattern) = &entry.args_pattern {
        match compile_pattern(pattern) {
            Ok(re) => {
                let joined = args.join("\x1F");
                if !re.is_match(&joined) {
                    return Decision::deny(
                        "profile.shell_args_pattern_mismatch",
                        format!("args did not match pattern for '{bin}'"),
                    );
                }
            }
            Err(e) => {
                return Decision::deny(
                    "profile.shell_pattern_invalid",
                    format!("bad args_pattern for '{bin}': {e}"),
                )
            }
        }
    }
    // Refuse suspicious metacharacters in any arg (defense-in-depth).
    for a in args {
        if contains_shell_meta(a) {
            return Decision::deny(
                "profile.shell_meta_chars",
                format!("arg contains shell metacharacters: '{a}'"),
            );
        }
    }
    Decision::allow()
}

/// Canonicalized file-read enforcement: reject paths outside scope or matching deny_globs.
///
/// AUDIT-015 — `project_and_docs` semantics: the canonical path must lie
/// either under the canonical project root or under one of the canonical
/// `fs.docs_roots` entries. With an empty `docs_roots`, the mode behaves
/// identically to `project_root` for reads (strict project-only scope).
/// `deny_globs` continues to apply on top as a deny-wins filter.
pub fn enforce_fs_read(p: &CapabilityProfile, path: &Path, project_root: &Path) -> Decision {
    if p.fs.read == "none" {
        return Decision::deny("profile.fs_read_disabled", "fs.read is 'none'");
    }
    let canon_p = canonicalize_best_effort(path);
    let canon_root = canonicalize_best_effort(project_root);
    let under_project = canon_p.starts_with(&canon_root);

    let in_scope = match p.fs.read.as_str() {
        "project_root" => under_project,
        "project_and_docs" => {
            under_project
                || p.fs.docs_roots.iter().any(|d| {
                    let canon_d = canonicalize_best_effort(&expand_user(d));
                    !canon_d.as_os_str().is_empty() && canon_p.starts_with(&canon_d)
                })
        }
        // Unknown modes deny-by-default; keeps invalid YAML from silently
        // widening read scope.
        other => {
            return Decision::deny(
                "profile.fs_read_unknown",
                format!("unknown fs.read mode: {other}"),
            )
        }
    };

    if !in_scope {
        return Decision::deny(
            "profile.fs_out_of_scope",
            format!(
                "path {:?} not under project_root {:?} or any configured docs_roots",
                canon_p, canon_root
            ),
        );
    }

    if glob_deny_match(&p.fs.deny_globs, &canon_p, &canon_root) {
        return Decision::deny(
            "profile.fs_deny_glob",
            format!("path {:?} matches deny_globs", canon_p),
        );
    }
    Decision::allow()
}

/// Expand a leading `~` to the user's home dir. Returns the path unchanged
/// when no `~` prefix is present or when `HOME` is unset (in which case the
/// caller-supplied literal path is kept and will simply fail to match real
/// canonical paths, which is the safe fallback).
fn expand_user(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    if raw == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(raw)
}

/// Canonicalized file-write enforcement.
pub fn enforce_fs_write(p: &CapabilityProfile, path: &Path, project_root: &Path) -> Decision {
    match p.fs.write.as_str() {
        "none" => Decision::deny("profile.fs_write_disabled", "fs.write is 'none'"),
        "project_root" => {
            let canon_p = canonicalize_best_effort(path);
            let canon_root = canonicalize_best_effort(project_root);
            if !canon_p.starts_with(&canon_root) {
                return Decision::deny(
                    "profile.fs_out_of_scope",
                    format!("write path {:?} out of project", canon_p),
                );
            }
            if glob_deny_match(&p.fs.deny_globs, &canon_p, &canon_root) {
                return Decision::deny(
                    "profile.fs_deny_glob",
                    format!("write path {:?} matches deny_globs", canon_p),
                );
            }
            Decision::allow()
        }
        "scoped_paths" => {
            let canon_p = canonicalize_best_effort(path);
            let canon_root = canonicalize_best_effort(project_root);
            let rel = canon_p
                .strip_prefix(&canon_root)
                .map(|r| r.to_string_lossy().to_string())
                .unwrap_or_else(|_| canon_p.to_string_lossy().to_string());
            let scoped = build_globs(&p.fs.scoped_paths);
            if !scoped.is_match(&rel) {
                return Decision::deny(
                    "profile.fs_scoped_paths_mismatch",
                    format!("write path {rel} not in scoped_paths"),
                );
            }
            if glob_deny_match(&p.fs.deny_globs, &canon_p, &canon_root) {
                return Decision::deny(
                    "profile.fs_deny_glob",
                    format!("write path {rel} matches deny_globs"),
                );
            }
            Decision::allow()
        }
        other => Decision::deny(
            "profile.fs_write_unknown",
            format!("unknown fs.write mode: {other}"),
        ),
    }
}

/// Check network egress target host + method.
///
/// DNS names are case-insensitive per RFC 4343; we match ASCII-lowercase.
/// HTTP methods compared case-insensitively.
pub fn enforce_network(p: &CapabilityProfile, host: &str, method: &str) -> Decision {
    match p.network_egress.mode.as_str() {
        "off" => Decision::deny("profile.egress_disabled", "network_egress is off"),
        "unrestricted" => Decision::allow(),
        "allowlist" => {
            let host_lc = host.to_ascii_lowercase();
            let host_match = p
                .network_egress
                .host_allowlist
                .iter()
                .any(|h| h.eq_ignore_ascii_case(&host_lc));
            if !host_match {
                return Decision::deny(
                    "profile.egress_host",
                    format!("host '{host}' not in host_allowlist"),
                );
            }
            if !p
                .network_egress
                .methods_allow
                .iter()
                .any(|m| m.eq_ignore_ascii_case(method))
            {
                return Decision::deny(
                    "profile.egress_method",
                    format!("method '{method}' not allowed"),
                );
            }
            Decision::allow()
        }
        other => Decision::deny(
            "profile.egress_mode_unknown",
            format!("unknown mode: {other}"),
        ),
    }
}

// --- helpers ---

fn matches_any(patterns: &[String], target: &str) -> bool {
    for p in patterns {
        if p == target {
            return true;
        }
        if p.contains('*') || p.contains('?') || p.contains('[') {
            if let Ok(glob) = Glob::new(p) {
                if glob.compile_matcher().is_match(target) {
                    return true;
                }
            }
        }
    }
    false
}

fn contains_shell_meta(s: &str) -> bool {
    const METAS: &[char] = &[
        ';', '&', '|', '`', '$', '>', '<', '\n', '\r', '\0', '(', ')', '{', '}', '\\',
    ];
    s.chars().any(|c| METAS.contains(&c))
}

/// Compile a user-supplied regex with bounded size/complexity to limit ReDoS surface.
/// Patterns come from trusted profile YAMLs today, but we cap anyway for defense-in-depth.
fn compile_pattern(p: &str) -> Result<Regex, regex::Error> {
    regex::RegexBuilder::new(p)
        .size_limit(64 * 1024) // cap compiled size
        .dfa_size_limit(256 * 1024) // cap DFA state
        .build()
}

fn build_globs(patterns: &[String]) -> GlobSet {
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        if let Ok(g) = Glob::new(p) {
            b.add(g);
        }
    }
    b.build().unwrap_or_else(|_| GlobSet::empty())
}

/// Match deny_globs against (a) relative path from project_root, and (b) basename.
/// This handles both "**/.ssh/**" patterns (full-relative) and ".env*" patterns (basename).
fn glob_deny_match(patterns: &[String], canon_path: &Path, canon_root: &Path) -> bool {
    let globs = build_globs(patterns);
    let rel = canon_path
        .strip_prefix(canon_root)
        .map(|r| r.to_string_lossy().to_string())
        .unwrap_or_else(|_| canon_path.to_string_lossy().to_string());
    if globs.is_match(&rel) {
        return true;
    }
    if let Some(bn) = canon_path.file_name().and_then(|s| s.to_str()) {
        if globs.is_match(bn) {
            return true;
        }
    }
    // Also try matching the full canonical path (for absolute paths like /etc/passwd).
    globs.is_match(canon_path.to_string_lossy().as_ref())
}

fn canonicalize_best_effort(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}
