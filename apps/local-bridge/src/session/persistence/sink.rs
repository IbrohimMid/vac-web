//! Cheap clone-able handle that lets the bridge's emit path record
//! every `ServerEvent` to the durable [`SessionPersistence`] without
//! threading the trait object + sequence counter + redaction mode
//! through every spawn closure individually.
//!
//! A [`PersistenceSink`] holds:
//! - the trait object (cheap `Arc::clone`),
//! - the VAC session id (the persistence key),
//! - a shared monotonic seq counter (so multiple emit paths agree on
//!   ordering without locking),
//! - the redaction mode in effect for this session,
//! - a [`PersistenceHealth`] handle so any append/save/forget failure
//!   flips the process-global degraded flag and is recorded in the
//!   recent-failure ring,
//! - an optional `broadcast::Sender<ServerEvent>` so a degradation can
//!   surface as a `session.persistence_degraded` ServerEvent on the
//!   same per-session bus that everything else flows through.
//!
//! `record` is non-async and never panics on persistence failure: a
//! corrupt fs or read-only disk surfaces as a `tracing::warn!`, a
//! dropped event line, a flipped health flag, and an out-of-band
//! `session.persistence_degraded` event — never as a session crash.
//! The bridge's durability story is best-effort — we never let
//! persistence take down a live ACP session.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::model::{PersistedServerEvent, PersistedSessionStatus};
use super::redact::{redact_event_payload, RedactionMode};
use super::{PersistenceError, PersistenceHealth, SessionPersistence};
use crate::ws::envelope::ServerEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct PersistenceSink {
    inner: Arc<dyn SessionPersistence>,
    vac_session_id: String,
    seq: Arc<AtomicU64>,
    mode: RedactionMode,
    health: PersistenceHealth,
    /// Optional per-session broadcast bus. When present, persistence
    /// failures emit a `session.persistence_degraded` ServerEvent so
    /// any subscriber (the cockpit's transport) can render a sticky
    /// chip immediately, without waiting for the next
    /// `session.history.list` round-trip.
    bus: Option<broadcast::Sender<ServerEvent>>,
}

impl PersistenceSink {
    /// Construct a sink with no health signalling — used by tests and
    /// by callers that only care about the durable-write side. Most
    /// production callers should reach for [`PersistenceSink::with_health`]
    /// instead.
    pub fn new(
        inner: Arc<dyn SessionPersistence>,
        vac_session_id: String,
        mode: RedactionMode,
    ) -> Self {
        Self::with_health(inner, vac_session_id, mode, PersistenceHealth::new(), None)
    }

    /// Construct a sink with a shared [`PersistenceHealth`] handle and
    /// optional per-session broadcast bus. Failures recorded by this
    /// sink will flip the shared health flag and (when `bus` is
    /// `Some`) emit a `session.persistence_degraded` ServerEvent.
    pub fn with_health(
        inner: Arc<dyn SessionPersistence>,
        vac_session_id: String,
        mode: RedactionMode,
        health: PersistenceHealth,
        bus: Option<broadcast::Sender<ServerEvent>>,
    ) -> Self {
        Self {
            inner,
            vac_session_id,
            seq: Arc::new(AtomicU64::new(0)),
            mode,
            health,
            bus,
        }
    }

    /// Persist a single `ServerEvent`. The payload is redacted in
    /// place on a *clone* (the broadcast / ring keep the original).
    pub fn record(&self, event: &ServerEvent) {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        let mut payload = event.payload.clone();
        // The redactor returns the strongest action it had to take
        // (Safe / Bounded / Dropped). Stamp it on the persisted row
        // so the resume-replay UI can be honest about what was
        // scrubbed before disk — stamping every row as `Safe` (the
        // pre-Stage-X6 behaviour) silently lied to the user.
        let redaction = redact_event_payload(&mut payload, self.mode);
        // `ServerEvent.ts` is a free-form RFC3339 string for wire
        // compatibility; the persisted row demands a typed
        // `DateTime<Utc>`. Best-effort parse: if the string is not a
        // valid RFC3339 timestamp we fall back to `Utc::now()` so a
        // malformed `ts` cannot drop the event from the durable log.
        let ts = chrono::DateTime::parse_from_rfc3339(&event.ts)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let pe = PersistedServerEvent {
            seq,
            event_type: event.event_type.clone(),
            payload,
            ts,
            redaction,
        };
        if let Err(e) = self.inner.append_event(&self.vac_session_id, &pe) {
            tracing::warn!(
                session = %self.vac_session_id,
                error = %e,
                "persistence.append_event failed; event dropped from durable log"
            );
            self.signal_degraded("append_failed", &e);
        }
    }

    pub fn mark_status(&self, status: PersistedSessionStatus) {
        if let Err(e) = self.inner.mark_status(&self.vac_session_id, status) {
            tracing::warn!(
                session = %self.vac_session_id,
                error = %e,
                "persistence.mark_status failed"
            );
            self.signal_degraded("meta_save_failed", &e);
        }
    }

    pub fn mark_closed(&self) {
        self.mark_status(PersistedSessionStatus::Closed);
    }

    pub fn mark_failed(&self) {
        self.mark_status(PersistedSessionStatus::Failed);
    }

    pub fn vac_session_id(&self) -> &str {
        &self.vac_session_id
    }

    /// Snapshot health state for tests / callers that hold a sink
    /// reference. Cheap clone of the shared `Arc` inner.
    pub fn health(&self) -> PersistenceHealth {
        self.health.clone()
    }

    fn signal_degraded(&self, reason: &'static str, err: &PersistenceError) {
        let detail = err.to_string();
        self.health
            .record_failure(reason, detail.clone(), Some(&self.vac_session_id));
        if let Some(bus) = &self.bus {
            // Best-effort broadcast: a closed channel (no subscribers)
            // is fine; the listed-payload path still surfaces the
            // degradation on the next `session.history.list` round trip.
            let evt = ServerEvent {
                seq: 0,
                session_id: self.vac_session_id.clone(),
                event_type: "session.persistence_degraded".into(),
                payload: serde_json::json!({
                    "vac_session_id": self.vac_session_id,
                    "reason": reason,
                    "detail": detail,
                }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            };
            let _ = bus.send(evt);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::persistence::{PersistedSessionMeta, SessionHistoryFilter};
    use std::sync::Mutex;

    /// In-memory stub that lets us choose, per call, whether `append_event`
    /// succeeds or fails. Lets the unit tests below exercise the health /
    /// degraded-event paths without touching the filesystem.
    #[derive(Default)]
    struct ToggleStore {
        fail_append: Mutex<bool>,
    }

    impl ToggleStore {
        fn set_append_fails(&self, b: bool) {
            *self.fail_append.lock().unwrap() = b;
        }
    }

    impl SessionPersistence for ToggleStore {
        fn save_meta(&self, _meta: &PersistedSessionMeta) -> super::super::PersistenceResult<()> {
            Ok(())
        }
        fn load_meta(
            &self,
            _id: &str,
        ) -> super::super::PersistenceResult<Option<PersistedSessionMeta>> {
            Ok(None)
        }
        fn list(
            &self,
            _f: &SessionHistoryFilter,
        ) -> super::super::PersistenceResult<Vec<PersistedSessionMeta>> {
            Ok(vec![])
        }
        fn append_event(
            &self,
            _id: &str,
            _ev: &PersistedServerEvent,
        ) -> super::super::PersistenceResult<()> {
            if *self.fail_append.lock().unwrap() {
                Err(PersistenceError::CorruptMeta {
                    path: "<test>".into(),
                    reason: "injected".into(),
                })
            } else {
                Ok(())
            }
        }
        fn load_events(
            &self,
            _id: &str,
            _l: usize,
        ) -> super::super::PersistenceResult<Vec<PersistedServerEvent>> {
            Ok(vec![])
        }
        fn mark_status(
            &self,
            _id: &str,
            _s: PersistedSessionStatus,
        ) -> super::super::PersistenceResult<()> {
            Ok(())
        }
        fn forget(&self, _id: &str) -> super::super::PersistenceResult<()> {
            Ok(())
        }
    }

    fn ok_event() -> ServerEvent {
        ServerEvent {
            seq: 0,
            session_id: "sess_alpha".into(),
            event_type: "test.event".into(),
            payload: serde_json::json!({}),
            v: 1,
            ts: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn append_success_keeps_health_clean() {
        let store = Arc::new(ToggleStore::default());
        let health = PersistenceHealth::new();
        let sink = PersistenceSink::with_health(
            store,
            "sess_alpha".into(),
            RedactionMode::Standard,
            health.clone(),
            None,
        );
        sink.record(&ok_event());
        assert!(!health.is_degraded(), "healthy after a successful append");
        assert_eq!(health.failure_count(), 0);
    }

    #[test]
    fn append_failure_flips_health_and_records_reason() {
        let store = Arc::new(ToggleStore::default());
        store.set_append_fails(true);
        let health = PersistenceHealth::new();
        let sink = PersistenceSink::with_health(
            Arc::clone(&store) as Arc<dyn SessionPersistence>,
            "sess_alpha".into(),
            RedactionMode::Standard,
            health.clone(),
            None,
        );
        sink.record(&ok_event());
        assert!(health.is_degraded(), "degraded after a failing append");
        let recent = health.recent_failures();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].reason, "append_failed");
        assert_eq!(recent[0].vac_session_id.as_deref(), Some("sess_alpha"));
    }

    #[test]
    fn append_failure_emits_session_persistence_degraded_event() {
        let store = Arc::new(ToggleStore::default());
        store.set_append_fails(true);
        let (tx, mut rx) = broadcast::channel::<ServerEvent>(8);
        let health = PersistenceHealth::new();
        let sink = PersistenceSink::with_health(
            Arc::clone(&store) as Arc<dyn SessionPersistence>,
            "sess_alpha".into(),
            RedactionMode::Standard,
            health,
            Some(tx),
        );
        sink.record(&ok_event());
        let evt = rx.try_recv().expect("degraded event broadcast");
        assert_eq!(evt.event_type, "session.persistence_degraded");
        let payload = evt.payload;
        assert_eq!(
            payload.get("vac_session_id").and_then(|v| v.as_str()),
            Some("sess_alpha")
        );
        assert_eq!(
            payload.get("reason").and_then(|v| v.as_str()),
            Some("append_failed")
        );
        assert!(payload
            .get("detail")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false));
    }

    #[test]
    fn legacy_new_keeps_isolated_health() {
        // PersistenceSink::new builds a fresh PersistenceHealth so
        // tests that don't pass a shared one don't accidentally bleed
        // failures into other tests.
        let store = Arc::new(ToggleStore::default());
        store.set_append_fails(true);
        let sink = PersistenceSink::new(
            Arc::clone(&store) as Arc<dyn SessionPersistence>,
            "sess_alpha".into(),
            RedactionMode::Standard,
        );
        sink.record(&ok_event());
        assert!(sink.health().is_degraded());
    }
}
