//! Session manager: spawn child process (mock-engine or vac serve), multiplex events.

mod assessment_validation;
mod handle;
mod registry;

pub use handle::{
    ApprovalIntent, ApprovalResolution, ApprovalResolveError, AuthenticateError,
    AuthenticateOutcome, SessionHandle, SessionHandleRef, SpawnOptions,
};
pub use registry::SessionRegistry;
