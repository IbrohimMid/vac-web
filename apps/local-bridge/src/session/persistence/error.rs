//! Persistence error type.
//!
//! Phase 1 of the durable-session-history milestone. Kept narrow on
//! purpose so the file-store, future SQLite-store, and any test
//! double can all return a single error type to callers.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("persistence i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("persistence serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("persistence: session `{0}` not found")]
    NotFound(String),
    #[error("persistence: corrupt session meta at {path}: {reason}")]
    CorruptMeta { path: String, reason: String },
    #[error("persistence: invalid session id `{0}`")]
    InvalidSessionId(String),
}

pub type PersistenceResult<T> = Result<T, PersistenceError>;
