//! Session manager: spawn child process (mock-engine or vac serve), multiplex events.

mod assessment_validation;
mod handle;
pub mod persistence;
mod registry;

pub use handle::{
    AcpRuntime, ApprovalIntent, ApprovalResolution, ApprovalResolveError, AuthenticateError,
    AuthenticateOutcome, SessionHandle, SessionHandleRef, SpawnOptions,
};
pub use registry::{ResumeNativeOutcome, ResumeValidationFailure, SessionRegistry};
