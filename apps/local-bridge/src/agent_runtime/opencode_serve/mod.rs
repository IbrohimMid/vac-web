//! Stage X.5h.2 — OpenCode serve HTTP API tap.
//!
//! Subscribes to `/event` SSE on an `opencode acp`/`opencode serve` child's
//! HTTP server, parses out session and tool-call frames, and exposes a
//! typed `Stream` so `session/handle.rs` can correlate sub-agent tool
//! activity to the parent Task `tool_call_id`.
//!
//! Step 2 of Stage X.5h.2 — see `.ci-logs/opencode-serve-api.md` for the
//! port-discovery decision (`opencode acp --port N --hostname H`) and
//! the endpoint table. Bridge wiring (Step 3) lives in `session/handle.rs`
//! and `acp/launcher.rs`.
//!
//! **Observe-only.** This module never sends commands back to the
//! opencode child; it only reads `/event`, `/session`, and similar GETs.

mod client;
mod events;
mod tap;

pub use client::{OpencodeServeClient, OpencodeServeError, Result as OpencodeServeResult};
pub use events::{OpencodeServeEvent, SessionMeta};

#[cfg(test)]
mod tests;

pub use tap::{OpencodeSubagentTap, SubagentToolEvent};
