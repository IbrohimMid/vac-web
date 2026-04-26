//! Session manager: spawn child process (mock-engine or vac serve), multiplex events.

mod handle;
mod registry;

pub use handle::{
    ApprovalIntent, ApprovalResolution, ApprovalResolveError, SessionHandle, SessionHandleRef,
    SpawnOptions,
};
pub use registry::SessionRegistry;
