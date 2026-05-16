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
