//! On-disk model for persisted sessions and events.
//!
//! Phase 1 of the durable-session-history milestone. The file-store
//! writes these structs verbatim as JSON / JSONL. Bumping the
//! `PERSISTENCE_VERSION` constant is required when the on-disk shape
//! changes in a non-backward-compatible way.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Schema version baked into every `meta.json`. Increment only when
/// the on-disk shape changes incompatibly.
pub const PERSISTENCE_VERSION: u32 = 1;

/// Newtype wrapper so `meta.json` shows `"version": 1` (a plain
/// number) and a future migration step can match on this directly
/// without worrying about parsing structurally different roots.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PersistenceVersion(pub u32);

impl Default for PersistenceVersion {
    fn default() -> Self {
        Self(PERSISTENCE_VERSION)
    }
}

/// Lifecycle status as observed by the bridge. `Forgotten` is a
/// short-lived terminal state; the directory is normally removed
/// before the status is observed by anyone, but having an enum value
/// lets us distinguish a soft-deleted row from a missing one.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersistedSessionStatus {
    Active,
    Closed,
    Failed,
    Forgotten,
}

/// Native-resume capability snapshot recorded at `session/new` time.
/// `last_verified_at` is `None` until the bridge actually completes a
/// successful `session/load` in Phase 4.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PersistenceNativeResume {
    pub load_session_supported: bool,
    pub last_verified_at: Option<DateTime<Utc>>,
}

/// Per-session metadata. One row per session, stored at
/// `<root>/<vac_session_id>/meta.json`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PersistedSessionMeta {
    pub version: PersistenceVersion,
    pub vac_session_id: String,
    /// Agent's session id from `session/new`. Optional because the
    /// metadata row is created right before the agent responds in
    /// some flows (and stays `None` for replay-only restores).
    pub agent_session_id: Option<String>,
    pub agent_id: String,
    pub agent_kind: String,
    pub project_root: PathBuf,
    pub profile_id: String,
    pub workflow_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub status: PersistedSessionStatus,
    #[serde(default)]
    pub native_resume: PersistenceNativeResume,
    #[serde(default)]
    pub mcp_servers: Vec<serde_json::Value>,
    #[serde(default)]
    pub agent_capabilities: serde_json::Value,
}

/// Redaction label written next to every persisted event so the
/// resume-replay path can decide whether to surface a payload or
/// stub it as `"<redacted>"`. `Safe` is the default (no scrubbing
/// applied or no scrubbing necessary).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionLabel {
    #[default]
    Safe,
    Bounded,
    Dropped,
}

/// One persisted event. Stored as a single JSONL line under
/// `<root>/<vac_session_id>/events.jsonl`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct PersistedServerEvent {
    pub seq: u64,
    /// Bridge `ServerEvent::type` (e.g. `transcript.delta`).
    /// Stored as a free-form string so adding new event variants
    /// upstream doesn't require a schema migration here.
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
    pub ts: DateTime<Utc>,
    #[serde(default)]
    pub redaction: RedactionLabel,
}

/// Filter applied by [`super::SessionPersistence::list`].
#[derive(Clone, Debug, Default)]
pub struct SessionHistoryFilter {
    pub project_root: Option<PathBuf>,
    pub agent_id: Option<String>,
    pub status: Option<PersistedSessionStatus>,
    pub limit: Option<usize>,
}
