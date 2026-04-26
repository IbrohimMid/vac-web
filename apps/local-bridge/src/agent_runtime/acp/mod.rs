//! Stage X.5b ACP client — JSON-RPC 2.0 over ndjson against an ACP
//! Agent (e.g. `claude-agent-acp`).
//!
//! See [`docs/plans/stage-x5a-acp-client-design.md`](../../../../../docs/plans/stage-x5a-acp-client-design.md)
//! for the design decision (Rust-native, hand-rolled minimal types,
//! stream-json adapter demoted to fallback).

pub mod client;
pub mod hash;
pub mod tool_activity;
pub mod types;

pub use client::{classify_jsonrpc_error, AcpClient, JsonRpcError, PermissionRequest};
pub use hash::{sha256_hex_canonical, sha256_hex_canonical_excluding, TOOL_CALL_HASH_DROP_FIELDS};
pub use tool_activity::{
    bound_raw_output, extract_observed_tool_activity, redact_raw_input, redact_raw_output,
    ObservedToolActivity, ToolDiff, ToolKind, ToolLocation, ToolStatus,
    DEFAULT_RAW_OUTPUT_CAP_BYTES, SECRET_REDACTION, TRUNCATION_MARKER,
};
pub use types::{
    CancelNotification, ClientCapabilities, ContentBlock, FsClientCapabilities, InitializeRequest,
    InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
    SessionNotification,
};
