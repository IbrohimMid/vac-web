//! On-disk trust config I/O: load + save + path resolution.

use anyhow::Result;
use profile_core::extension_trust::ExtensionTrustConfig;
use std::path::PathBuf;

const DEFAULT_PATH: &str = "config/extension-trust.yaml";
const ENV_OVERRIDE: &str = "VAC_EXTENSION_TRUST_PATH";

pub fn resolve_path() -> PathBuf {
    std::env::var(ENV_OVERRIDE)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_PATH))
}

pub fn load() -> Result<ExtensionTrustConfig> {
    let path = resolve_path();
    if !path.exists() {
        return Ok(ExtensionTrustConfig::empty());
    }
    ExtensionTrustConfig::load(&path)
}

pub fn save(cfg: &ExtensionTrustConfig) -> Result<()> {
    let path = resolve_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    cfg.save(&path)
}
