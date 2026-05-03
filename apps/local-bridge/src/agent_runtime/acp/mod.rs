//! ACP client — JSON-RPC 2.0 over ndjson against an ACP Agent
//! (e.g. `claude-agent-acp`).
//!
//! See [`docs/agent-runtime.md`](../../../../../docs/agent-runtime.md)
//! for the durable runtime contract. Historical stage-plan notes were
//! retired; current implementation work is tracked in `docs/plans/`.

pub mod client;
pub mod debug;
pub mod fs_handler;
pub mod hash;
pub mod terminal_handler;
pub mod tool_activity;
pub mod types;

pub use client::{
    classify_jsonrpc_error, AcpClient, FsRequest, JsonRpcError, PermissionRequest, TerminalRequest,
};
pub use debug::{AcpDebugDirection, AcpDebugLog, AcpDebugMessage, AcpDebugMessageType};
pub use fs_handler::{FsError, FsHandlerContext};
pub use hash::{sha256_hex_canonical, sha256_hex_canonical_excluding, TOOL_CALL_HASH_DROP_FIELDS};
pub use terminal_handler::{TerminalError, TerminalHandlerContext};
pub use tool_activity::{
    bound_raw_output, extract_observed_tool_activity, redact_raw_input, redact_raw_output,
    ObservedToolActivity, ToolDiff, ToolKind, ToolLocation, ToolStatus,
    DEFAULT_RAW_OUTPUT_CAP_BYTES, SECRET_REDACTION, TRUNCATION_MARKER,
};
pub use types::{
    AcpPlanEntry, AcpSessionUpdate, AcpToolCall, AcpToolCallUpdate, AuthClientCapabilities,
    AuthenticateRequest, AuthenticateResponse, CancelNotification, ClientCapabilities,
    ContentBlock, FsClientCapabilities, InitializeRequest, InitializeResponse, NewSessionRequest,
    NewSessionResponse, PromptRequest, PromptResponse, SessionNotification,
};
