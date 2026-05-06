//! Admin gate for `extensions.update_trust`.
//!
//! Audit hardening 2026-05-06 (BLOCKER-1 fix #2): the
//! `extensions.update_trust` command is sessionless, which means the
//! profile-layer `enforce_action` gate (keyed off `session_id` ->
//! `profile_id`) does not apply. Without an additional gate, any caller
//! that can reach the websocket can mutate
//! `config/extension-trust.yaml`.
//!
//! This module enforces a deny-by-default admin token check:
//! - Operators set the env var `VAC_EXTENSIONS_ADMIN` on the bridge to a
//!   non-empty secret string. Leaving it unset locks
//!   `extensions.update_trust` for everyone.
//! - Callers must echo that same secret as `admin_token` in the command
//!   payload.
//!
//! A future slice will replace this with proper session-bound
//! profile-class gating once `extensions.update_trust` becomes
//! session-bound. See the audit verdict on commit `0dca68f` for
//! context.

use serde_json::Value;

const ENV_ADMIN_SECRET: &str = "VAC_EXTENSIONS_ADMIN";

#[derive(Debug)]
pub enum AdminGateError {
    /// Bridge operator has not opted into `update_trust` by setting
    /// `VAC_EXTENSIONS_ADMIN` to a non-empty value.
    NotConfigured,
    /// Caller did not include `admin_token` in the payload.
    TokenMissing,
    /// Caller supplied a token that does not match the env secret.
    TokenMismatch,
}

impl AdminGateError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::NotConfigured => {
                "extensions.update_trust is disabled: set VAC_EXTENSIONS_ADMIN on the bridge"
            }
            Self::TokenMissing => "extensions.update_trust requires admin_token in payload",
            Self::TokenMismatch => "admin_token does not match VAC_EXTENSIONS_ADMIN",
        }
    }
}

/// Validate that the caller is allowed to invoke
/// `extensions.update_trust`.
pub fn check(payload: &Value) -> Result<(), AdminGateError> {
    let raw = std::env::var(ENV_ADMIN_SECRET).ok();
    let expected: String = match raw.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => return Err(AdminGateError::NotConfigured),
    };
    let provided = payload
        .get("admin_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let provided = match provided {
        Some(s) => s,
        None => return Err(AdminGateError::TokenMissing),
    };
    if expected == provided {
        Ok(())
    } else {
        Err(AdminGateError::TokenMismatch)
    }
}

#[cfg(test)]
pub mod testing {
    //! Test-only helpers for serializing env-var manipulation.
    //!
    //! `std::env::set_var` and `remove_var` mutate process-global state,
    //! which races with parallel tests. Callers must hold the mutex
    //! returned by [`env_lock`] for the duration of any test that
    //! depends on `VAC_EXTENSIONS_ADMIN`.

    use std::sync::{Mutex, MutexGuard};

    static LOCK: Mutex<()> = Mutex::new(());

    pub fn env_lock() -> MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[allow(unused_unsafe)]
    pub fn set_secret(value: &str) {
        // SAFETY: callers hold env_lock(); env mutation is process-wide.
        unsafe {
            std::env::set_var(super::ENV_ADMIN_SECRET, value);
        }
    }

    #[allow(unused_unsafe)]
    pub fn clear_secret() {
        // SAFETY: callers hold env_lock(); env mutation is process-wide.
        unsafe {
            std::env::remove_var(super::ENV_ADMIN_SECRET);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_when_env_not_set() {
        let _g = testing::env_lock();
        testing::clear_secret();
        let err = check(&json!({"admin_token": "anything"})).unwrap_err();
        assert!(matches!(err, AdminGateError::NotConfigured));
    }

    #[test]
    fn rejects_when_token_missing() {
        let _g = testing::env_lock();
        testing::set_secret("super-secret");
        let err = check(&json!({})).unwrap_err();
        assert!(matches!(err, AdminGateError::TokenMissing));
        testing::clear_secret();
    }

    #[test]
    fn rejects_on_mismatch() {
        let _g = testing::env_lock();
        testing::set_secret("super-secret");
        let err = check(&json!({"admin_token": "wrong"})).unwrap_err();
        assert!(matches!(err, AdminGateError::TokenMismatch));
        testing::clear_secret();
    }

    #[test]
    fn allows_on_match() {
        let _g = testing::env_lock();
        testing::set_secret("super-secret");
        check(&json!({"admin_token": "super-secret"})).expect("matching token passes");
        testing::clear_secret();
    }
}
