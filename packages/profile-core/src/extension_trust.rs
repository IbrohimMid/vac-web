//! Extension trust enforcement — runtime side of the trust model documented in
//! `docs/extension-trust-model.md` and ADR `docs/adr/0003-extension-trust-model.md`.
//!
//! Phase 2 stub. Real implementation must:
//! 1. Load `config/extension-trust.yaml` at startup (or on cockpit refresh).
//! 2. For each extension request, classify into `TrustDecision` based on
//!    publisher signature, allowlist entry, and revocation list.
//! 3. Return a deterministic decision so the bridge enforce layer can act on it.
//!
//! Phase 1 (current) behavior: always returns `TrustDecision::AllowedBundled`
//! for any input. This is safe because no caller invokes this function yet.

use serde::{Deserialize, Serialize};

/// Trust tier assigned to an extension at enforcement time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustDecision {
    /// Bundled with the workspace, implicitly trusted.
    AllowedBundled,
    /// Externally signed by an allowlisted publisher.
    AllowedSigned,
    /// Loaded but sandboxed; no privileged capabilities granted.
    Quarantined,
    /// Explicitly revoked; refuse to load.
    Revoked,
}

/// Caller-supplied context for the enforcement decision. Phase 2 will expand
/// this to include signature material, publisher pubkey, etc.
#[derive(Debug, Clone)]
pub struct EnforceContext<'a> {
    pub extension_id: &'a str,
    pub signature_b64: Option<&'a str>,
    pub publisher_pubkey_b64: Option<&'a str>,
}

/// Decide the trust tier for an extension request.
///
/// Phase 1 stub: always returns `AllowedBundled`. Phase 2 implements real
/// classification against `config/extension-trust.yaml`.
pub fn enforce_extension_trust(_ctx: &EnforceContext<'_>) -> TrustDecision {
    // TODO(phase-2): real classification (see module-level docs).
    TrustDecision::AllowedBundled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase1_stub_returns_allowed_bundled() {
        let ctx = EnforceContext {
            extension_id: "vac.example",
            signature_b64: None,
            publisher_pubkey_b64: None,
        };
        assert_eq!(enforce_extension_trust(&ctx), TrustDecision::AllowedBundled);
    }
}
