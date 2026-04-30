//! Bridge-local storage indices.
//!
//! Phase: P3 of the assessment durability milestone.
//!
//! The session [`persistence`](crate::session::persistence) layer is the
//! source of truth: every assessment.* server event is persisted to a
//! per-session JSONL log. Querying assessment.list_runs / fetch_report /
//! diff today scans that log linearly, which becomes expensive once a
//! workspace accumulates thousands of runs across many sessions.
//!
//! This module hosts a *cache index* over the same events: a small SQLite
//! database with one row per run / finding / sweep, populated by the
//! same code path that appends to the JSONL log. Reads can short-circuit
//! by hitting the index first and falling back to JSONL only when the
//! index is missing data (cold start, schema migration, or an explicit
//! flush). Writes never fail the request even when the index is offline
//! — it is opportunistic, not authoritative.
//!
//! For now the module exposes only the [`AssessmentIndex`] foundation;
//! Phase P3.1 (a follow-up commit) will wire it into the
//! [`PersistenceSink`](crate::session::persistence::PersistenceSink) so
//! events are double-written, and Phase P3.2 will switch the
//! [`assessment_query`](crate::translator::assessment_query) reader to
//! consult it before scanning the log.

pub mod assessment_index;
pub mod assessment_writer;

pub use assessment_index::{
    AssessmentFindingRow, AssessmentIndex, AssessmentIndexError, AssessmentRunRow,
    AssessmentSweepRow, ASSESSMENT_INDEX_SCHEMA_VERSION,
};
pub use assessment_writer::{is_mirrored, record_event, WriteOutcome, MIRRORED_EVENT_TYPES};
