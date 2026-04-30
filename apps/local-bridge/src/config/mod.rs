//! Stage R3 — declarative control-plane config.
//!
//! YAML lives under `config/`. Each config file is parsed into a
//! forgiving `Raw*` shape via serde, then normalized into a strict
//! runtime struct. The strict struct is the only thing the rest of
//! the bridge consults at runtime; the YAML can only pick between
//! behaviors the runtime already supports.
//!
//! Currently scoped to session-resume policy; R4 expands this
//! module to cover the whole `config/vac.yaml` import graph.

pub mod loader;
pub mod resume_policy;

pub use loader::{
    AgentRegistryItem, AgentRegistrySummary, ConfigSnapshot, LoadOutcome, LoaderPaths,
    McpServerItem, McpServersSummary,
};
pub use resume_policy::{
    Diagnostic, DiagnosticSeverity, McpDriftPolicy, NativeFallbackPolicy, ProfileClassPolicy,
    RawResumePolicy, RawSessionResumeBlock, ResumeDefaultMode, SessionResumePolicy,
    DEFAULT_MAX_EVENTS, DEFAULT_RETENTION_DAYS,
};
