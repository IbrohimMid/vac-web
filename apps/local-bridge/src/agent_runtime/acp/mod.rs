//! Stage X.5b ACP client — JSON-RPC 2.0 over ndjson against an ACP
//! Agent (e.g. `claude-agent-acp`).
//!
//! See [`docs/plans/stage-x5a-acp-client-design.md`](../../../../../docs/plans/stage-x5a-acp-client-design.md)
//! for the design decision (Rust-native, hand-rolled minimal types,
//! stream-json adapter demoted to fallback).

pub mod client;
pub mod types;

pub use client::{classify_jsonrpc_error, AcpClient, JsonRpcError};
pub use types::{
    CancelNotification, ClientCapabilities, ContentBlock, FsClientCapabilities, InitializeRequest,
    InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
    SessionNotification,
};
