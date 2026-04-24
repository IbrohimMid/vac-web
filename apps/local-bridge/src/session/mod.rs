//! Session manager: spawn child process (mock-engine or vac serve), multiplex events.

mod handle;
mod registry;

pub use handle::{SessionHandle, SessionHandleRef, SpawnOptions};
pub use registry::SessionRegistry;
