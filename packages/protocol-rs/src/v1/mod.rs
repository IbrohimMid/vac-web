//! Protocol v1 types.
//!
//! Generated modules live under `generated/`. Each schema becomes one
//! submodule; tests can import as `protocol_rs::v1::<name>::<Type>`.

pub mod generated;

// Re-export submodules so external callers can use either
// `protocol_rs::v1::evidence_ref::EvidenceRef`
// or
// `protocol_rs::v1::EvidenceRef`.
pub use generated::*;

pub struct ProtocolVersion;
impl ProtocolVersion {
    pub const V1: &'static str = "1";
}
