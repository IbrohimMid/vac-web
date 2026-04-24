//! Bridge error taxonomy. Every variant maps to a stable `code` used in
//! protocol `Ack.error.code`.

use crate::session_state::SessionState;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, BridgeError>;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("session state illegal: {from:?} → {to:?}")]
    InvalidTransition {
        from: SessionState,
        to: SessionState,
    },

    #[error("replay out of range: requested {requested}, oldest {oldest}")]
    ReplayOutOfRange { requested: u64, oldest: u64 },

    #[error("resource exhausted: {what}")]
    ResourceExhausted { what: &'static str },

    #[error("audit write failed: {0}")]
    Audit(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("internal: {0}")]
    Internal(String),
}

impl BridgeError {
    /// Stable error code for protocol Ack.error.code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::SessionNotFound(_) => "session.not_found",
            Self::InvalidTransition { .. } => "session.invalid_state",
            Self::ReplayOutOfRange { .. } => "replay.out_of_range",
            Self::ResourceExhausted { .. } => "resource.exhausted",
            Self::Audit(_) => "audit.write_failed",
            Self::Io(_) => "io.error",
            Self::Internal(_) => "internal",
        }
    }
}
