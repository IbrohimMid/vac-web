//! Two-party approval flow for extensions trust transitions (Slice #6).
//!
//! `extensions.update_trust` rejects any `revoked -> allowed_*` transition
//! outright. This module adds a request/approve flow:
//!
//! 1. A session sends `extensions.request_promotion` for an extension
//!    currently `revoked`. The bridge enregisters a pending request keyed
//!    by an opaque request_id.
//! 2. A different session (different `profile_id`) sends
//!    `extensions.approve_promotion` with the request_id. The bridge
//!    validates that the approver != requester via `profile_id`, then
//!    applies the trust update, marks the request `approved`, and emits
//!    structured audit + event frames.
//!
//! Persistence: JSON snapshot at `<cwd>/config/extensions-approvals.json`
//! (override via `VAC_EXTENSIONS_APPROVALS_PATH`). Atomic save via the
//! `NamedTempFile` + `persist` pattern used by `store.rs`, file-locked
//! with `fs2::FileExt` to avoid TOCTOU.

use anyhow::{Context, Result};
use chrono::Utc;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const ENV_PATH: &str = "VAC_EXTENSIONS_APPROVALS_PATH";
const DEFAULT_PATH: &str = "config/extensions-approvals.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub request_id: String,
    pub extension_id: String,
    pub requested_tier: String,
    pub requested_by_session_id: String,
    pub requested_by_profile_id: String,
    pub created_at: String,
    pub status: ApprovalStatus,
    pub decided_at: Option<String>,
    pub decided_by_session_id: Option<String>,
    pub decided_by_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalsConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub requests: Vec<ApprovalRequest>,
}

impl Default for ApprovalsConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            requests: Vec::new(),
        }
    }
}

fn default_version() -> u32 {
    1
}

pub fn resolve_path() -> PathBuf {
    if let Ok(p) = std::env::var(ENV_PATH) {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    PathBuf::from(DEFAULT_PATH)
}

fn lock_path(p: &Path) -> PathBuf {
    PathBuf::from(format!("{}.lock", p.to_string_lossy()))
}

pub fn load() -> Result<ApprovalsConfig> {
    let path = resolve_path();
    if !path.exists() {
        return Ok(ApprovalsConfig::default());
    }
    let bytes = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    if bytes.is_empty() {
        return Ok(ApprovalsConfig::default());
    }
    let cfg: ApprovalsConfig =
        serde_json::from_slice(&bytes).with_context(|| format!("parse {}", path.display()))?;
    Ok(cfg)
}

pub struct LockedApprovals {
    _lock_file: File,
    path: PathBuf,
    pub config: ApprovalsConfig,
}

impl LockedApprovals {
    pub fn acquire() -> Result<Self> {
        let path = resolve_path();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("mkdir {}", parent.display()))?;
            }
        }
        let lp = lock_path(&path);
        let lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&lp)
            .with_context(|| format!("open lock {}", lp.display()))?;
        lock_file
            .lock_exclusive()
            .with_context(|| format!("lock {}", lp.display()))?;
        let config = if path.exists() {
            let bytes = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            if bytes.is_empty() {
                ApprovalsConfig::default()
            } else {
                serde_json::from_slice(&bytes)
                    .with_context(|| format!("parse {}", path.display()))?
            }
        } else {
            ApprovalsConfig::default()
        };
        Ok(Self {
            _lock_file: lock_file,
            path,
            config,
        })
    }

    pub fn commit(self) -> Result<()> {
        let parent = self
            .path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut tmp = NamedTempFile::new_in(parent)
            .with_context(|| format!("tempfile in {}", parent.display()))?;
        let bytes = serde_json::to_vec_pretty(&self.config).context("serialize approvals")?;
        tmp.write_all(&bytes).context("write approvals temp")?;
        tmp.flush().ok();
        tmp.persist(&self.path)
            .map_err(|e| anyhow::anyhow!("persist {}: {}", self.path.display(), e))?;
        Ok(())
    }
}

/// Generate an opaque request id from a high-resolution timestamp +
/// monotonic counter. Avoids pulling in `uuid` for a single call site.
pub fn new_request_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    format!("req-{ts:x}-{counter:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp<F: FnOnce()>(f: F) {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("approvals.json");
        std::env::set_var(ENV_PATH, &path);
        f();
        std::env::remove_var(ENV_PATH);
    }

    fn sample_req() -> ApprovalRequest {
        ApprovalRequest {
            request_id: "req-test".into(),
            extension_id: "ext-a".into(),
            requested_tier: "allowed_signed".into(),
            requested_by_session_id: "s-1".into(),
            requested_by_profile_id: "p-1".into(),
            created_at: "2026-05-07T00:00:00Z".into(),
            status: ApprovalStatus::Pending,
            decided_at: None,
            decided_by_session_id: None,
            decided_by_profile_id: None,
        }
    }

    #[test]
    fn locked_approvals_round_trip_through_atomic_save() {
        with_temp(|| {
            let mut locked = LockedApprovals::acquire().unwrap();
            assert!(locked.config.requests.is_empty());
            locked.config.requests.push(sample_req());
            locked.commit().unwrap();
            let cfg = load().unwrap();
            assert_eq!(cfg.requests.len(), 1);
            assert_eq!(cfg.requests[0].request_id, "req-test");
            assert!(matches!(cfg.requests[0].status, ApprovalStatus::Pending));
        });
    }

    #[test]
    fn locked_approvals_drop_without_commit_discards_changes() {
        with_temp(|| {
            {
                let mut locked = LockedApprovals::acquire().unwrap();
                locked.config.requests.push(sample_req());
            }
            let cfg = load().unwrap();
            assert!(cfg.requests.is_empty());
        });
    }

    #[test]
    fn new_request_id_is_unique_across_calls() {
        let a = new_request_id();
        let b = new_request_id();
        assert_ne!(a, b);
        assert!(a.starts_with("req-"));
    }
}
