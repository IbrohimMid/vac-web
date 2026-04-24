//! Session state machine + enforced transition matrix.

use crate::error::{BridgeError, Result};
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SessionState {
    Spawning,
    Ready,
    Active,
    Idle,
    Closing,
    Closed,
}

impl SessionState {
    pub fn is_terminal(self) -> bool {
        matches!(self, SessionState::Closed)
    }
    pub fn is_open(self) -> bool {
        matches!(
            self,
            SessionState::Spawning
                | SessionState::Ready
                | SessionState::Active
                | SessionState::Idle
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    Graceful,
    Crashed,
    Timeout,
    ResourceExhausted,
    Cancelled,
}

pub fn allowed_transition(from: SessionState, to: SessionState) -> bool {
    use SessionState::*;
    matches!(
        (from, to),
        (Spawning, Ready)
            | (Spawning, Closing)
            | (Spawning, Closed)
            | (Ready, Active)
            | (Ready, Closing)
            | (Ready, Idle)
            | (Active, Idle)
            | (Active, Closing)
            | (Idle, Active)
            | (Idle, Closing)
            | (Closing, Closed)
    )
}

pub struct StateHolder {
    state: RwLock<SessionState>,
    close_reason: RwLock<Option<CloseReason>>,
}

impl StateHolder {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(SessionState::Spawning),
            close_reason: RwLock::new(None),
        }
    }

    pub fn current(&self) -> SessionState {
        *self.state.read().unwrap()
    }

    pub fn close_reason(&self) -> Option<CloseReason> {
        *self.close_reason.read().unwrap()
    }

    pub fn transition(&self, to: SessionState) -> Result<SessionState> {
        let mut guard = self.state.write().unwrap();
        if *guard == to {
            return Ok(to);
        }
        if !allowed_transition(*guard, to) {
            return Err(BridgeError::InvalidTransition { from: *guard, to });
        }
        let prev = *guard;
        *guard = to;
        Ok(prev)
    }

    pub fn set_close_reason(&self, r: CloseReason) {
        *self.close_reason.write().unwrap() = Some(r);
    }
}

impl Default for StateHolder {
    fn default() -> Self {
        Self::new()
    }
}
