//! VIL-style workflow layer for local-bridge.
//!
//! Implements the process/workflow pattern from VIL architecture:
//! each session spawns a WorkflowProcess that maps bridge semantic
//! events to workflow step advances and emits workflow.* events.
//!
//! Axum is transport substrate only. Product orchestration logic
//! lives here, not in route handlers.

pub mod adapters;
pub mod events;
pub mod executor;
pub mod process;
pub mod registry;
pub mod spec;

pub use registry::WorkflowRegistry;
