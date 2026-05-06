//! Extension trust enforcement — runtime side of the trust model documented in
//! `docs/extension-trust-model.md` and ADR `docs/adr/0003-extension-trust-model.md`.
//!
//! Phase 2 implementation (F1, 2026-05-07): real classification against
//! `config/extension-trust.yaml`. Replaces the Phase 1 stub.
//!
//! Algorithm (deny-by-default):
//! 1. Look up the extension by id in `config.extensions`.
//! 2. If found:
//!    - tier=revoked       → Revoked
//!    - tier=quarantined   → Quarantined
//!    - tier=allowed_bundled + source=bundled → AllowedBundled
//!    - tier=allowed_signed + source=signed:
//!        • require non-empty signature_b64 in ctx
//!        • require ctx.publisher_pubkey_b64 == entry.publisher
//!        • require entry.publisher ∈ config.publishers (allowlist)
//!      All three pass → AllowedSigned, else Quarantined
//!    - any other (tier, source) mismatch → Quarantined (safe default)
//! 3. If not found:
//!    - config.allow_unsigned=true  → AllowedBundled
//!    - config.allow_unsigned=false → Quarantined

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Trust tier assigned to an extension at enforcement time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustDecision {
    /// Bundled with the workspace, implicitly trusted.
    AllowedBundled,
    /// Externally signed by an allowlisted publisher with valid signature.
    AllowedSigned,
    /// Loaded but sandboxed; no privileged capabilities granted.
    Quarantined,
    /// Explicitly revoked; refuse to load.
    Revoked,
}

/// Tier as declared in the YAML config (string-typed via serde rename).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionTier {
    AllowedBundled,
    AllowedSigned,
    Quarantined,
    Revoked,
}

/// Source of an extension as declared in the YAML config.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionSource {
    Bundled,
    Signed,
}

/// One row in the YAML config's `extensions:` list.
#[derive(Debug, Clone, Deserialize)]
pub struct ExtensionEntry {
    pub id: String,
    pub tier: ExtensionTier,
    pub source: ExtensionSource,
    #[serde(default)]
    pub publisher: Option<String>,
}

/// On-disk schema for `config/extension-trust.yaml`.
#[derive(Debug, Clone, Deserialize)]
pub struct ExtensionTrustConfig {
    pub version: u32,
    pub allow_unsigned: bool,
    #[serde(default)]
    pub publishers: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl ExtensionTrustConfig {
    /// Load and validate config from a YAML file on disk.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        let cfg: Self = serde_yaml::from_str(&raw)?;
        if cfg.version != 1 {
            anyhow::bail!(
                "unsupported extension-trust schema version: {} (expected 1)",
                cfg.version
            );
        }
        Ok(cfg)
    }

    /// An empty deny-by-default config (allow_unsigned=false, no entries).
    pub fn empty() -> Self {
        Self {
            version: 1,
            allow_unsigned: false,
            publishers: Vec::new(),
            extensions: Vec::new(),
        }
    }
}

/// Caller-supplied context for the enforcement decision.
#[derive(Debug, Clone)]
pub struct EnforceContext<'a> {
    pub extension_id: &'a str,
    pub signature_b64: Option<&'a str>,
    pub publisher_pubkey_b64: Option<&'a str>,
}

/// Decide the trust tier for an extension request.
///
/// Pure function. No I/O, no panics. See module-level docs for the algorithm.
pub fn enforce_extension_trust(
    ctx: &EnforceContext<'_>,
    config: &ExtensionTrustConfig,
) -> TrustDecision {
    let entry = config.extensions.iter().find(|e| e.id == ctx.extension_id);

    match entry {
        Some(e) => match (e.tier, e.source) {
            (ExtensionTier::Revoked, _) => TrustDecision::Revoked,
            (ExtensionTier::Quarantined, _) => TrustDecision::Quarantined,
            (ExtensionTier::AllowedBundled, ExtensionSource::Bundled) => {
                TrustDecision::AllowedBundled
            }
            (ExtensionTier::AllowedSigned, ExtensionSource::Signed) => {
                let publisher_match = match (&e.publisher, ctx.publisher_pubkey_b64) {
                    (Some(expected), Some(provided)) => {
                        expected == provided && config.publishers.iter().any(|p| p == provided)
                    }
                    _ => false,
                };
                let has_signature = ctx.signature_b64.map(|s| !s.is_empty()).unwrap_or(false);
                if publisher_match && has_signature {
                    TrustDecision::AllowedSigned
                } else {
                    TrustDecision::Quarantined
                }
            }
            // Mismatch between declared tier and source → quarantine for safety.
            _ => TrustDecision::Quarantined,
        },
        None => {
            if config.allow_unsigned {
                TrustDecision::AllowedBundled
            } else {
                TrustDecision::Quarantined
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(id: &'a str, sig: Option<&'a str>, pubkey: Option<&'a str>) -> EnforceContext<'a> {
        EnforceContext {
            extension_id: id,
            signature_b64: sig,
            publisher_pubkey_b64: pubkey,
        }
    }

    fn entry(
        id: &str,
        tier: ExtensionTier,
        source: ExtensionSource,
        publisher: Option<&str>,
    ) -> ExtensionEntry {
        ExtensionEntry {
            id: id.to_string(),
            tier,
            source,
            publisher: publisher.map(|s| s.to_string()),
        }
    }

    #[test]
    fn empty_config_denies_unknown_extension() {
        let cfg = ExtensionTrustConfig::empty();
        assert_eq!(
            enforce_extension_trust(&ctx("vac.unknown", None, None), &cfg),
            TrustDecision::Quarantined
        );
    }

    #[test]
    fn allow_unsigned_grants_bundled_to_unknown() {
        let mut cfg = ExtensionTrustConfig::empty();
        cfg.allow_unsigned = true;
        assert_eq!(
            enforce_extension_trust(&ctx("vac.unknown", None, None), &cfg),
            TrustDecision::AllowedBundled
        );
    }

    #[test]
    fn bundled_entry_returns_allowed_bundled() {
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![],
            extensions: vec![entry(
                "vac.review-tab",
                ExtensionTier::AllowedBundled,
                ExtensionSource::Bundled,
                None,
            )],
        };
        assert_eq!(
            enforce_extension_trust(&ctx("vac.review-tab", None, None), &cfg),
            TrustDecision::AllowedBundled
        );
    }

    #[test]
    fn signed_entry_with_matching_publisher_and_signature_allowed() {
        let pubkey = "pub-abc";
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![pubkey.into()],
            extensions: vec![entry(
                "vac.signed-ext",
                ExtensionTier::AllowedSigned,
                ExtensionSource::Signed,
                Some(pubkey),
            )],
        };
        assert_eq!(
            enforce_extension_trust(&ctx("vac.signed-ext", Some("sig-xyz"), Some(pubkey)), &cfg),
            TrustDecision::AllowedSigned
        );
    }

    #[test]
    fn signed_entry_without_signature_quarantined() {
        let pubkey = "pub-abc";
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![pubkey.into()],
            extensions: vec![entry(
                "vac.signed-ext",
                ExtensionTier::AllowedSigned,
                ExtensionSource::Signed,
                Some(pubkey),
            )],
        };
        assert_eq!(
            enforce_extension_trust(&ctx("vac.signed-ext", None, Some(pubkey)), &cfg),
            TrustDecision::Quarantined
        );
    }

    #[test]
    fn signed_entry_with_unauthorized_publisher_quarantined() {
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec!["pub-trusted".into()],
            extensions: vec![entry(
                "vac.signed-ext",
                ExtensionTier::AllowedSigned,
                ExtensionSource::Signed,
                Some("pub-trusted"),
            )],
        };
        assert_eq!(
            enforce_extension_trust(
                &ctx("vac.signed-ext", Some("sig-xyz"), Some("pub-attacker")),
                &cfg
            ),
            TrustDecision::Quarantined
        );
    }

    #[test]
    fn signed_entry_with_publisher_not_in_allowlist_quarantined() {
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![], // publisher not in allowlist
            extensions: vec![entry(
                "vac.signed-ext",
                ExtensionTier::AllowedSigned,
                ExtensionSource::Signed,
                Some("pub-trusted"),
            )],
        };
        assert_eq!(
            enforce_extension_trust(
                &ctx("vac.signed-ext", Some("sig-xyz"), Some("pub-trusted")),
                &cfg
            ),
            TrustDecision::Quarantined
        );
    }

    #[test]
    fn revoked_entry_returns_revoked() {
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![],
            extensions: vec![entry(
                "vac.bad-ext",
                ExtensionTier::Revoked,
                ExtensionSource::Bundled,
                None,
            )],
        };
        assert_eq!(
            enforce_extension_trust(&ctx("vac.bad-ext", None, None), &cfg),
            TrustDecision::Revoked
        );
    }

    #[test]
    fn quarantined_entry_returns_quarantined() {
        let cfg = ExtensionTrustConfig {
            version: 1,
            allow_unsigned: false,
            publishers: vec![],
            extensions: vec![entry(
                "vac.sketchy-ext",
                ExtensionTier::Quarantined,
                ExtensionSource::Bundled,
                None,
            )],
        };
        assert_eq!(
            enforce_extension_trust(&ctx("vac.sketchy-ext", None, None), &cfg),
            TrustDecision::Quarantined
        );
    }

    #[test]
    fn loads_yaml_config_from_disk() {
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        writeln!(tmp, "version: 1").unwrap();
        writeln!(tmp, "allow_unsigned: false").unwrap();
        writeln!(tmp, "publishers: []").unwrap();
        writeln!(tmp, "extensions: []").unwrap();
        tmp.flush().unwrap();
        let cfg = ExtensionTrustConfig::load(tmp.path()).unwrap();
        assert_eq!(cfg.version, 1);
        assert!(!cfg.allow_unsigned);
        assert!(cfg.publishers.is_empty());
        assert!(cfg.extensions.is_empty());
    }

    #[test]
    fn rejects_unsupported_version() {
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        writeln!(tmp, "version: 99").unwrap();
        writeln!(tmp, "allow_unsigned: false").unwrap();
        writeln!(tmp, "publishers: []").unwrap();
        writeln!(tmp, "extensions: []").unwrap();
        tmp.flush().unwrap();
        let err = ExtensionTrustConfig::load(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("unsupported"));
    }
}
