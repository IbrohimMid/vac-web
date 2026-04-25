//! Typed, actionable errors for AgentRuntime config + resolution.
//!
//! Stage X.1 deliberately keeps these stringly so an operator can read
//! `vac-bridge` stderr and fix the config file without grepping source.

use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentRuntimeError {
    #[error("agents config at {path}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("agents config at {path}: parse error: {message}")]
    Parse { path: PathBuf, message: String },

    #[error("agents config at {path}: agent `{id}` has unknown kind `{kind}` (expected mock|vac-native|acp)")]
    UnknownKind {
        path: PathBuf,
        id: String,
        kind: String,
    },

    #[error("agents config: agent `{id}` has empty `command`")]
    EmptyCommand { id: String },

    #[error("agents config: agent `{id}` permission_timeout_ms = {value}; minimum is {min}")]
    PermissionTimeoutTooLow { id: String, value: u64, min: u64 },

    #[error("agents config: duplicate agent id `{id}`")]
    DuplicateId { id: String },

    #[error("agents config: default_agent `{id}` is not defined")]
    DefaultMissing { id: String },

    #[error("agents config: default_agent `{id}` is disabled")]
    DefaultDisabled { id: String },

    #[error("agents config: no agents are enabled — at least one must have enabled = true")]
    NoEnabledAgents,

    #[error("agents config: agent `{id}` not found")]
    NotFound { id: String },

    #[error("agents config: agent id must be non-empty and only [a-z0-9_-]; got `{id}`")]
    InvalidId { id: String },
}

pub type Result<T> = std::result::Result<T, AgentRuntimeError>;
