//! Per-install JWT secret for the local bridge daemon (AUDIT-011).
//!
//! Generates 32 bytes of OS CSPRNG randomness on first run and persists it
//! hex-encoded to `$XDG_CONFIG_HOME/vac-web/bridge.secret` (fallback
//! `$HOME/.config/vac-web/bridge.secret`) with mode 0600. Subsequent runs
//! load it from that file.
//!
//! Boundary contract: the production daemon MUST construct
//! `AuthState::new(secret)` via this loader. The dev anonymous fallback
//! (`AuthState::new_dev`) is opt-in via env `VAC_DEV_ANONYMOUS_AUTH=1`
//! and emits a loud stderr banner from `main.rs`.

use anyhow::{anyhow, Context, Result};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MIN_SECRET_BYTES: usize = 32;

/// Load the per-install JWT secret, generating + persisting a new one on
/// first run. Errors are fatal: the caller MUST refuse to start with
/// anonymous auth instead of silently falling back.
pub fn load_or_create() -> Result<Vec<u8>> {
    load_or_create_at(&default_path())
}

pub fn default_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| PathBuf::from("/tmp"))
        });
    base.join("vac-web").join("bridge.secret")
}

fn load_or_create_at(path: &Path) -> Result<Vec<u8>> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).with_context(|| format!("create_dir_all {}", dir.display()))?;
    }
    if path.exists() {
        let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let trimmed = raw.trim();
        let bytes = hex::decode(trimmed)
            .with_context(|| format!("hex-decode contents of {}", path.display()))?;
        if bytes.len() < MIN_SECRET_BYTES {
            return Err(anyhow!(
                "{} must contain >={} bytes of hex-encoded secret; got {} bytes",
                path.display(),
                MIN_SECRET_BYTES,
                bytes.len()
            ));
        }
        tracing::info!(path = %path.display(), "bridge JWT secret loaded");
        return Ok(bytes);
    }
    // Portable across rand 0.8/0.9/0.10: Standard distribution for u8 is
    // implemented in every version, so per-byte sampling works regardless
    // of trait reorgs. The bytes are OS-CSPRNG-backed via rand's default RNG.
    let mut bytes = vec![0u8; MIN_SECRET_BYTES];
    for b in bytes.iter_mut() {
        *b = rand::random::<u8>();
    }
    write_private(path, hex::encode(&bytes).as_bytes())
        .with_context(|| format!("write {}", path.display()))?;
    tracing::warn!(path = %path.display(), "generated new bridge JWT secret (first run)");
    Ok(bytes)
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("vac-web-secret-{label}-{nanos}"))
            .join("bridge.secret")
    }

    #[test]
    fn generate_then_load_round_trip() {
        let path = temp_path("rt");
        let a = load_or_create_at(&path).unwrap();
        let b = load_or_create_at(&path).unwrap();
        assert_eq!(a, b);
        assert!(a.len() >= 32);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn rejects_short_secret() {
        let path = temp_path("short");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "deadbeef").unwrap();
        assert!(load_or_create_at(&path).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn rejects_non_hex() {
        let path = temp_path("nonhex");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not hex at all").unwrap();
        assert!(load_or_create_at(&path).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
