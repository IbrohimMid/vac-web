//! Session persistence layer.
//!
//! Phase 1 of the durable-session-history milestone:
//!
//! - Defines the [`SessionPersistence`] trait that the bridge will
//!   call to save `session/new` metadata, append per-session events,
//!   and forget sessions on user request.
//! - Provides a file-backed implementation ([`FilePersistence`]) that
//!   writes JSONL under `$XDG_DATA_HOME/vac-web/bridge/sessions`.
//! - Provides a defensive [`redact`] pass for payloads.
//!
//! Wiring into [`crate::session::SessionRegistry`] and the WS
//! translator is intentionally **deferred** to Phase 2 / Phase 3 so
//! this commit can ship as a self-contained foundation with unit
//! tests only. Nothing in the bridge currently calls into this
//! module, but `lib.rs` exposes it under `session::persistence` so
//! later commits can reach for the trait without re-registering it.

mod error;
mod file_store;
mod model;
mod redact;
mod sink;

pub use error::{PersistenceError, PersistenceResult};
pub use file_store::FilePersistence;
pub use model::{
    PersistedServerEvent, PersistedSessionMeta, PersistedSessionStatus, PersistenceNativeResume,
    PersistenceVersion, RedactionLabel, SessionHistoryFilter, PERSISTENCE_VERSION,
};
pub use redact::{redact_event_payload, RedactionMode};
pub use sink::PersistenceSink;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Durable backend for VAC session history.
///
/// All operations are synchronous and blocking. Implementations are
/// expected to be cheap on the bridge's hot path (a few millisecond
/// fs writes) and may serialise mutations internally. The bridge
/// holds a single `Arc<dyn SessionPersistence>` for the whole process.
pub trait SessionPersistence: Send + Sync {
    /// Create or atomically replace the metadata row for a session.
    fn save_meta(&self, meta: &PersistedSessionMeta) -> PersistenceResult<()>;

    /// Load a single session's metadata, returning `Ok(None)` when
    /// the session is unknown. Corrupt rows surface as
    /// [`PersistenceError::CorruptMeta`].
    fn load_meta(&self, vac_session_id: &str) -> PersistenceResult<Option<PersistedSessionMeta>>;

    /// Enumerate persisted sessions matching `filter`. Implementations
    /// must be forgiving about a single corrupt row (skip + continue)
    /// so a bad write can't lock the UI out.
    fn list(&self, filter: &SessionHistoryFilter) -> PersistenceResult<Vec<PersistedSessionMeta>>;

    /// Append a single event to the session's transcript. The store
    /// is responsible for serialising concurrent appends so JSONL
    /// lines don't tear.
    fn append_event(
        &self,
        vac_session_id: &str,
        event: &PersistedServerEvent,
    ) -> PersistenceResult<()>;

    /// Load the persisted transcript for a session, oldest first. A
    /// `limit` of `0` means "return all events"; any positive value
    /// returns at most that many events from the *tail* of the log.
    fn load_events(
        &self,
        vac_session_id: &str,
        limit: usize,
    ) -> PersistenceResult<Vec<PersistedServerEvent>>;

    /// Update only the lifecycle status + `updated_at` of an existing
    /// session. Errors with [`PersistenceError::NotFound`] when the
    /// session does not exist.
    fn mark_status(
        &self,
        vac_session_id: &str,
        status: PersistedSessionStatus,
    ) -> PersistenceResult<()>;

    /// Idempotently remove a session and all its events. Forgetting an
    /// unknown session is a no-op and must not error.
    fn forget(&self, vac_session_id: &str) -> PersistenceResult<()>;
}

/// Convenience alias — the rest of the bridge holds the trait object
/// behind an `Arc` so it can be cheaply cloned into spawn paths.
pub type SharedPersistence = Arc<dyn SessionPersistence>;

/// Stage X6 P2-B — process-global persistence health signal.
///
/// Cheap-clone shared handle held by [`AppState`] (so the translator's
/// `session.history.list` arm can read the current state) and by every
/// [`PersistenceSink`] (so an `append_event` / `save_meta` / `forget`
/// failure flips the flag and records a structured failure record).
///
/// We deliberately keep this lightweight: a single `AtomicBool` for the
/// hot path ("is the bridge currently in a degraded persistence state?")
/// and a small ring of recent failure records for surfacing in the UI.
/// Once flipped to `degraded`, the flag stays set for the life of the
/// process — the cockpit prefers a sticky warning over flap-y chips.
#[derive(Debug, Clone, Default)]
pub struct PersistenceHealth {
    inner: Arc<PersistenceHealthInner>,
}

/// One ring slot's worth of context about a single persistence failure.
/// Stored newest-first inside [`PersistenceHealth`] and exported via
/// [`PersistenceHealth::recent_failures`] for the
/// `session.history.listed` `health` payload.
#[derive(Debug, Clone)]
pub struct PersistenceFailureRecord {
    /// Short slug — `"append_failed"` / `"meta_save_failed"` /
    /// `"forget_failed"` / `"load_meta_failed"`. Stable for UI mapping.
    pub reason: &'static str,
    /// Free-form detail (the underlying [`PersistenceError`] formatted
    /// via `Display`). Already redaction-safe.
    pub detail: String,
    /// VAC session id the failure happened on, when available. `None`
    /// for cross-cutting failures (e.g. the initial directory open).
    pub vac_session_id: Option<String>,
    /// Wall-clock time of the failure, in UTC.
    pub at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Default)]
struct PersistenceHealthInner {
    degraded: AtomicBool,
    failure_count: AtomicU64,
    /// Bounded ring of the most recent failures (newest-first). Capped
    /// at [`PERSISTENCE_HEALTH_RING_CAP`] entries so a runaway disk
    /// failure can't blow up bridge memory.
    recent: Mutex<VecDeque<PersistenceFailureRecord>>,
}

/// Cap on the number of failure records kept in memory at any time.
pub const PERSISTENCE_HEALTH_RING_CAP: usize = 16;

impl PersistenceHealth {
    /// Construct a fresh health handle in the healthy state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a single failure. Flips the sticky `degraded` flag and
    /// pushes a [`PersistenceFailureRecord`] onto the bounded ring.
    /// Cheap and lock-light: the only contention is the small `Mutex`
    /// around the ring, which is held for microseconds per call.
    pub fn record_failure(
        &self,
        reason: &'static str,
        detail: impl Into<String>,
        vac_session_id: Option<&str>,
    ) {
        self.inner.degraded.store(true, Ordering::Relaxed);
        self.inner.failure_count.fetch_add(1, Ordering::Relaxed);
        let record = PersistenceFailureRecord {
            reason,
            detail: detail.into(),
            vac_session_id: vac_session_id.map(str::to_string),
            at: chrono::Utc::now(),
        };
        if let Ok(mut ring) = self.inner.recent.lock() {
            if ring.len() >= PERSISTENCE_HEALTH_RING_CAP {
                ring.pop_back();
            }
            ring.push_front(record);
        }
    }

    /// `true` once any failure has been recorded for the life of this
    /// handle. Sticky by design — see the type-level docs.
    pub fn is_degraded(&self) -> bool {
        self.inner.degraded.load(Ordering::Relaxed)
    }

    /// Total number of failures observed since process start.
    pub fn failure_count(&self) -> u64 {
        self.inner.failure_count.load(Ordering::Relaxed)
    }

    /// Snapshot the bounded recent-failure ring, newest-first. Cheap
    /// `Vec` clone — the ring caps at
    /// [`PERSISTENCE_HEALTH_RING_CAP`] entries.
    pub fn recent_failures(&self) -> Vec<PersistenceFailureRecord> {
        self.inner
            .recent
            .lock()
            .map(|r| r.iter().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod health_tests {
    use super::*;

    #[test]
    fn starts_healthy() {
        let h = PersistenceHealth::new();
        assert!(!h.is_degraded());
        assert_eq!(h.failure_count(), 0);
        assert!(h.recent_failures().is_empty());
    }

    #[test]
    fn record_failure_flips_degraded_and_increments() {
        let h = PersistenceHealth::new();
        h.record_failure("append_failed", "disk full", Some("sess_alpha"));
        assert!(h.is_degraded());
        assert_eq!(h.failure_count(), 1);
        let recent = h.recent_failures();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].reason, "append_failed");
        assert_eq!(recent[0].detail, "disk full");
        assert_eq!(recent[0].vac_session_id.as_deref(), Some("sess_alpha"));
    }

    #[test]
    fn ring_caps_at_max() {
        let h = PersistenceHealth::new();
        for i in 0..(PERSISTENCE_HEALTH_RING_CAP + 5) {
            h.record_failure("append_failed", format!("err {i}"), None);
        }
        let recent = h.recent_failures();
        assert_eq!(recent.len(), PERSISTENCE_HEALTH_RING_CAP);
        // Newest-first: the very last failure recorded is at index 0.
        let expected_newest = format!("err {}", PERSISTENCE_HEALTH_RING_CAP + 4);
        assert_eq!(recent[0].detail, expected_newest);
    }

    #[test]
    fn clones_share_state() {
        let h = PersistenceHealth::new();
        let h2 = h.clone();
        h2.record_failure("meta_save_failed", "x", None);
        assert!(h.is_degraded());
        assert_eq!(h.failure_count(), 1);
    }
}
