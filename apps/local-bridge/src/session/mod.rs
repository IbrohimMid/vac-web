//! Session manager: spawn child process (mock-engine or vac serve), multiplex events.

pub(crate) mod assessment_validation;
pub(crate) mod bridge_mutation;
pub(crate) mod handle;
pub mod persistence;
mod registry;

pub use handle::{
    AcpRuntime, ApprovalIntent, ApprovalResolution, ApprovalResolveError, AuthenticateError,
    AuthenticateOutcome, SessionHandle, SessionHandleRef, SpawnOptions,
};
pub use registry::{
    ExecutorSpawnError, ResumeNativeOutcome, ResumeValidationFailure, SessionRegistry,
};

/// R08-F01 + R27-F02 + R27-F07 — authorize a caller against a session's
/// recorded owner principal. The bridge stamps each newly-created session
/// with the authenticated caller's principal via
/// [`SessionRegistry::set_owner`], and every WS dispatch / replay /
/// lazy-subscribe seam funnels through this helper before honoring a
/// command that names that session.
///
/// Semantics:
/// - `owner = None` — unowned (legacy / dev anonymous flow). Any caller
///   is allowed; this preserves the existing single-user dev experience
///   without dropping the gate for production tokens.
/// - `owner = Some(o)`, `caller = Some(c)` — strict equality. The
///   `device:<id>` principal minted by `ws::handler::principal_for_device`
///   is the canonical comparison value.
/// - `owner = Some(_)`, `caller = None` — owned session but no caller
///   principal: deny. A WS connection that never authenticated cannot
///   drive an owned session.
pub fn session_owner_authorized(owner: Option<&str>, caller: Option<&str>) -> bool {
    match (owner, caller) {
        (None, _) => true,
        (Some(o), Some(c)) => o == c,
        (Some(_), None) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unowned_session_allows_any_caller() {
        assert!(session_owner_authorized(None, None));
        assert!(session_owner_authorized(None, Some("dev:anonymous")));
        assert!(session_owner_authorized(None, Some("device:abc")));
    }

    #[test]
    fn owned_session_requires_matching_caller() {
        assert!(session_owner_authorized(
            Some("device:abc"),
            Some("device:abc")
        ));
    }

    #[test]
    fn owned_session_rejects_mismatched_caller() {
        assert!(!session_owner_authorized(
            Some("device:abc"),
            Some("device:def")
        ));
        assert!(!session_owner_authorized(
            Some("device:abc"),
            Some("dev:anonymous")
        ));
        assert!(!session_owner_authorized(Some("device:abc"), None));
    }
}
