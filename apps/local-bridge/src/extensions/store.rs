//! On-disk trust config I/O: load + save + path resolution + advisory
//! locking.
//!
//! Slice #1 hardening 2026-05-07 (TOCTOU): [`LockedConfig::acquire`]
//! opens an exclusive advisory lock on a sidecar `.lock` file, then
//! reloads the config inside the lock window. [`LockedConfig::commit`]
//! writes atomically via [`tempfile::NamedTempFile::persist`] (rename
//! into place on the same filesystem) and releases the lock on drop.

use anyhow::{Context, Result};
use fs2::FileExt;
use profile_core::extension_trust::ExtensionTrustConfig;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const DEFAULT_PATH: &str = "config/extension-trust.yaml";
const ENV_OVERRIDE: &str = "VAC_EXTENSION_TRUST_PATH";

pub fn resolve_path() -> PathBuf {
    std::env::var(ENV_OVERRIDE)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_PATH))
}

fn lock_path(cfg_path: &Path) -> PathBuf {
    let mut buf = cfg_path.as_os_str().to_owned();
    buf.push(".lock");
    PathBuf::from(buf)
}

pub fn load() -> Result<ExtensionTrustConfig> {
    let path = resolve_path();
    if !path.exists() {
        return Ok(ExtensionTrustConfig::empty());
    }
    ExtensionTrustConfig::load(&path)
}

fn save_atomic(path: &Path, cfg: &ExtensionTrustConfig) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).ok();
    let yaml = serde_yaml::to_string(cfg).context("serialize trust config")?;
    let mut tmp = NamedTempFile::new_in(parent).context("create temp file")?;
    tmp.write_all(yaml.as_bytes())
        .context("write trust config to temp file")?;
    let _ = tmp.as_file().sync_all();
    tmp.persist(path)
        .map_err(|e| anyhow::anyhow!("persist temp file -> {}: {}", path.display(), e))?;
    Ok(())
}

/// Save without taking the advisory lock. Kept for tests / one-shot
/// admin tooling that does not contend with the bridge.
#[allow(dead_code)]
pub fn save(cfg: &ExtensionTrustConfig) -> Result<()> {
    let path = resolve_path();
    save_atomic(&path, cfg)
}

/// Exclusive lock guard plus the loaded snapshot of the trust config.
///
/// Acquired via [`LockedConfig::acquire`]; the lock is held for the
/// lifetime of the value and released on drop. Mutate `config` in
/// place, then call [`LockedConfig::commit`] to write the result back
/// atomically. If the guard is dropped without `commit`, the in-memory
/// mutation is discarded and no on-disk change is made.
pub struct LockedConfig {
    _lock_file: File,
    path: PathBuf,
    pub config: ExtensionTrustConfig,
}

impl LockedConfig {
    pub fn acquire() -> Result<Self> {
        let path = resolve_path();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).context("create config parent")?;
            }
        }
        let lock_p = lock_path(&path);
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_p)
            .with_context(|| format!("open lock file {}", lock_p.display()))?;
        lock_file
            .lock_exclusive()
            .context("acquire exclusive lock on trust config")?;
        let config = if path.exists() {
            ExtensionTrustConfig::load(&path).context("load trust config under lock")?
        } else {
            ExtensionTrustConfig::empty()
        };
        Ok(Self {
            _lock_file: lock_file,
            path,
            config,
        })
    }

    pub fn commit(self) -> Result<()> {
        save_atomic(&self.path, &self.config)
        // _lock_file dropped here; advisory lock released on close.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use profile_core::extension_trust::{ExtensionEntry, ExtensionSource, ExtensionTier};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn entry(id: &str) -> ExtensionEntry {
        ExtensionEntry {
            id: id.into(),
            tier: ExtensionTier::AllowedBundled,
            source: ExtensionSource::Bundled,
            publisher: None,
        }
    }

    #[test]
    fn locked_config_round_trips_through_atomic_save() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg_path = dir.path().join("trust.yaml");
        std::env::set_var(ENV_OVERRIDE, &cfg_path);
        // Seed an initial config.
        let mut seed = ExtensionTrustConfig::empty();
        seed.extensions = vec![entry("vac.ext-a")];
        save_atomic(&cfg_path, &seed).expect("seed save");
        // Acquire lock, mutate, commit.
        {
            let mut locked = LockedConfig::acquire().expect("acquire");
            assert_eq!(locked.config.extensions.len(), 1);
            locked.config.extensions[0].tier = ExtensionTier::Quarantined;
            locked.commit().expect("commit");
        }
        // Reload and verify the mutation persisted.
        let reloaded = load().expect("reload");
        assert!(matches!(
            reloaded.extensions[0].tier,
            ExtensionTier::Quarantined
        ));
        // Lock file should exist as a sidecar.
        assert!(cfg_path.with_extension("yaml.lock").exists());
        std::env::remove_var(ENV_OVERRIDE);
    }

    #[test]
    fn locked_config_drop_without_commit_discards_changes() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg_path = dir.path().join("trust.yaml");
        std::env::set_var(ENV_OVERRIDE, &cfg_path);
        let mut seed = ExtensionTrustConfig::empty();
        seed.extensions = vec![entry("vac.ext-b")];
        save_atomic(&cfg_path, &seed).expect("seed save");
        {
            let mut locked = LockedConfig::acquire().expect("acquire");
            locked.config.extensions[0].tier = ExtensionTier::Revoked;
            // Drop without commit.
        }
        let reloaded = load().expect("reload");
        assert!(matches!(
            reloaded.extensions[0].tier,
            ExtensionTier::AllowedBundled
        ));
        std::env::remove_var(ENV_OVERRIDE);
    }
}
