//! Profile loader + enforcement primitives.
//!
//! Shared between bridge (Layer 1) and red-team tests. Kept intentionally small:
//! no network, no I/O beyond reading local YAML, no async.
//!
//! Inputs: `CapabilityProfile` YAML from `packages/protocol/v1/profiles/`.
//! Outputs: load-time validated profile + pure functions that enforce rules.

pub mod enforce;
pub mod extension_trust;
pub mod hash;
pub mod profile;

pub use enforce::{Decision, EnforceResult};
pub use extension_trust::{enforce_extension_trust, EnforceContext, TrustDecision};
pub use profile::{CapabilityProfile, Class, FsConfig, GitConfig, NetworkEgress, ShellAllowEntry};
