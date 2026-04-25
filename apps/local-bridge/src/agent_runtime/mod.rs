//! Agent runtime registry — Stage X.1 scaffolding.
//!
//! This module owns the *resolution* of which agent (mock | vac-native |
//! acp) should back a session. It does **not** own the wire protocol
//! (the browser still talks plain `session.create` without `agent_id`)
//! and it does **not** spawn ACP processes — only mock + vac-native are
//! actually launchable today, and both go through the existing stdio
//! shape preserved by `SessionHandle::spawn`.
//!
//! See [`docs/agent-runtime.md`](../../../../docs/agent-runtime.md) for
//! the X.0 design lock and X.1–X.8 substage breakdown.

pub mod acp;
pub mod config;
pub mod errors;
pub mod registry;

pub use config::{
    AgentDefinition, AgentKind, AgentsConfig, DEFAULT_PERMISSION_TIMEOUT_MS, EMBEDDED_DEFAULT_TOML,
    MIN_PERMISSION_TIMEOUT_MS,
};
pub use errors::{AgentRuntimeError, Result as AgentRuntimeResult};
pub use registry::{
    infer_legacy_agent_kind, synth_legacy_registry, AgentRuntimeRegistry, ConfigSource,
};
