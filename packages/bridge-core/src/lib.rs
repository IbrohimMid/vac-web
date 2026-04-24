//! Transport-agnostic primitives for local-bridge.
//!
//! Consumers: `apps/local-bridge`, `tests/integration`, `tests/red-team`.
//!
//! Design invariants:
//! 1. No HTTP/WebSocket code here — pure async/sync state + helpers.
//! 2. Every `BridgeError` carries a stable code usable in protocol `Ack.error.code`.
//! 3. `AuditWriter` is non-blocking: `try_send` drops with metric; never stalls caller.
//! 4. `EventRing` bounded; replay cursor detects `OutOfRange` vs `UpToDate`.
//! 5. `SessionState` transitions enforced via matrix; terminal states block further changes.

pub mod audit;
pub mod error;
pub mod event_ring;
pub mod resource;
pub mod session_state;

pub use audit::{AuditConfig, AuditEntry, AuditSeverity, AuditWriter};
pub use error::{BridgeError, Result};
pub use event_ring::{EventRing, ReplayResult};
pub use resource::{ChildGuard, ResourceLimits, ResourceSnapshot, ResourceUsage};
pub use session_state::{allowed_transition, CloseReason, SessionState, StateHolder};
