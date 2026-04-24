//! WebSocket transport: upgrade, handshake, envelope dispatch.

pub mod envelope;
mod handler;

pub use envelope::{ClientCommand, ServerEvent};
pub use handler::ws_handler;
