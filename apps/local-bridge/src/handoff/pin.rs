//! Bridge-owned HandoffPin computation.
//!
//! Pin authority: local-bridge computes this from the session's `project_root`,
//! not from the runtime provider. This prevents a provider from spoofing
//! the pin to bypass trust boundaries.
//!
//! Policy note: worktree digest covers tracked files only (`git ls-files`).
//! Untracked files are intentionally excluded — they are user workspace
//! noise, not the authoritative artifact set.

use crate::handoff::packet::{HandoffConnectorSnapshot, HandoffPin, PinPolicy};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;

const WORKTREE_DIGEST_EXCLUDE: &[&str] =
    &[".git", "node_modules", "target", ".next", "dist", "build"];

pub struct PinComputeOptions<'a> {
    pub project_root: &'a Path,
    pub repo_ref: Option<String>,
    pub base_commit_sha: Option<String>,
    pub assessment_snapshot_at: Option<String>,
    pub connector_snapshots: Vec<HandoffConnectorSnapshot>,
    pub invalidation_policy: PinPolicy,
    pub now: chrono::DateTime<chrono::Utc>,
}

impl Default for PinComputeOptions<'static> {
    fn default() -> Self {
        Self {
            project_root: Path::new(""),
            repo_ref: None,
            base_commit_sha: None,
            assessment_snapshot_at: None,
            connector_snapshots: Vec::new(),
            invalidation_policy: PinPolicy::Strict,
            now: chrono::Utc::now(),
        }
    }
}

fn git_output(project: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()?
        .trim()
        .to_string()
        .into()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn compute_worktree_digest(project: &Path) -> Option<String> {
    let out = Command::new("git")
        .current_dir(project)
        .args(["ls-files", "-z"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for entry in out
        .stdout
        .split(|b| *b == 0)
        .filter(|entry| !entry.is_empty())
    {
        let rel = String::from_utf8_lossy(entry).to_string();
        let skip = WORKTREE_DIGEST_EXCLUDE
            .iter()
            .any(|exc| rel.starts_with(exc));
        if skip {
            continue;
        }
        let file = project.join(&rel);
        let bytes = std::fs::read(&file).unwrap_or_default();
        parts.push(format!("{rel}:{}", sha256_hex(&bytes)));
    }
    parts.sort();
    Some(sha256_hex(parts.join("\n").as_bytes()))
}

pub fn compute_pin(opts: PinComputeOptions<'_>) -> HandoffPin {
    let repo_ref = opts
        .repo_ref
        .or_else(|| {
            git_output(opts.project_root, &["branch", "--show-current"])
                .filter(|b| !b.is_empty())
                .map(|b| format!("branch:{b}"))
        })
        .or_else(|| {
            git_output(opts.project_root, &["describe", "--tags", "--exact-match"])
                .filter(|t| !t.is_empty())
                .map(|t| format!("tag:{t}"))
        })
        .unwrap_or_else(|| {
            opts.base_commit_sha
                .clone()
                .map(|sha| format!("sha:{sha}"))
                .unwrap_or_default()
        });

    let base_commit_sha = opts
        .base_commit_sha
        .or_else(|| git_output(opts.project_root, &["rev-parse", "HEAD"]))
        .unwrap_or_default();

    let worktree_digest = compute_worktree_digest(opts.project_root).unwrap_or_default();

    let assessment_snapshot_at = opts
        .assessment_snapshot_at
        .unwrap_or_else(|| opts.now.to_rfc3339());

    let expires_at = (opts.now + chrono::Duration::days(7)).to_rfc3339();

    HandoffPin {
        repo_ref,
        base_commit_sha,
        worktree_digest,
        assessment_snapshot_at,
        connector_snapshots: opts.connector_snapshots,
        expires_at,
        invalidate_on_repo_change: opts.invalidation_policy == PinPolicy::Strict,
        invalidation_policy: opts.invalidation_policy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_hex() {
        let result = sha256_hex(b"hello");
        assert_eq!(result.len(), 64);
        assert!(result.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_pin_policy_default() {
        assert_eq!(PinPolicy::default().as_str(), "strict");
        assert_eq!(PinPolicy::Lenient.as_str(), "lenient");
        assert_eq!(PinPolicy::from_str("lenient"), PinPolicy::Lenient);
        assert_eq!(PinPolicy::from_str("anything"), PinPolicy::Strict);
    }

    #[test]
    fn test_pin_complete() {
        use crate::handoff::packet::HandoffPin;
        use chrono::Utc;

        let pin = HandoffPin {
            repo_ref: "branch:main".to_string(),
            base_commit_sha: "abc123".to_string(),
            worktree_digest: "digest123".to_string(),
            assessment_snapshot_at: Utc::now().to_rfc3339(),
            connector_snapshots: vec![],
            expires_at: (Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
            invalidate_on_repo_change: true,
            invalidation_policy: PinPolicy::Strict,
        };
        assert!(pin.is_complete());
        assert!(!pin.is_expired());
    }

    #[test]
    fn test_pin_incomplete() {
        use crate::handoff::packet::HandoffPin;
        use chrono::Utc;

        let pin = HandoffPin {
            repo_ref: "".to_string(),
            base_commit_sha: "abc123".to_string(),
            worktree_digest: "digest123".to_string(),
            assessment_snapshot_at: Utc::now().to_rfc3339(),
            connector_snapshots: vec![],
            expires_at: (Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
            invalidate_on_repo_change: true,
            invalidation_policy: PinPolicy::Strict,
        };
        assert!(!pin.is_complete());
    }
}
