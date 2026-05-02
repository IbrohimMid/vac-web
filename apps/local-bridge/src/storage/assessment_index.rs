//! SQLite cache index for assessment runs / findings / sweeps.
//!
//! See [`super`] for the design rationale. This module owns the schema, the
//! migration ladder, and a small CRUD-shaped API. It does **not** observe
//! events; the caller threads each persisted assessment.* event through
//! [`AssessmentIndex::record_run`], [`record_finding`], and
//! [`record_sweep`].
//!
//! Threading: a single `Connection` lives behind a `Mutex`. SQLite's own
//! locking would tolerate concurrent readers, but every write path here
//! goes through the bridge's persistence sink which already serialises
//! mutations, so the simple shared-mutex approach matches the existing
//! `FilePersistence` design and avoids surprising deadlocks under
//! `rusqlite`'s blocking API.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use thiserror::Error;

use crate::session::persistence::PersistedServerEvent;

use super::assessment_writer::record_event;

/// Bumped whenever the table layout changes. Migrations live in
/// [`AssessmentIndex::migrate`]; each version corresponds to one applied
/// `ALTER`/`CREATE` step.
pub const ASSESSMENT_INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum AssessmentIndexError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("index lock poisoned")]
    Poisoned,
    #[error("unsupported schema version: stored={stored}, expected<={expected}")]
    UnsupportedSchema { stored: u32, expected: u32 },
}

pub type Result<T> = std::result::Result<T, AssessmentIndexError>;

/// One row in `assessment_runs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssessmentRunRow {
    pub run_id: String,
    pub session_id: String,
    pub swarm: String,
    pub status: String,
    pub started_at: String,
    /// ISO-8601 datetime when the run reached a terminal state, if any.
    pub completed_at: Option<String>,
    pub verdict: Option<String>,
    /// JSON blob mirroring the public `Run` shape — the writer is responsible
    /// for keeping it in sync with the latest event for this run.
    pub payload_json: String,
}

/// One row in `assessment_findings`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssessmentFindingRow {
    pub finding_id: String,
    pub run_id: String,
    pub identity_hash: String,
    pub severity: String,
    pub category: String,
    pub emitted_at: String,
    pub payload_json: String,
}

/// One row in `assessment_sweeps`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssessmentSweepRow {
    pub sweep_id: String,
    pub session_id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub families_csv: String,
    pub payload_json: String,
}

/// Lightweight summary of the cache index for maintenance/status commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssessmentIndexStatus {
    pub schema_version: u32,
    pub runs: usize,
    pub findings: usize,
    pub sweeps: usize,
    pub last_indexed_at: Option<String>,
}

/// Small trait used by [`assessment_writer`](super::assessment_writer) so the
/// same event-to-row translation can run against either the live SQLite index
/// or a rebuild transaction.
pub trait AssessmentIndexStore {
    fn get_run(&self, run_id: &str) -> Result<Option<AssessmentRunRow>>;
    fn get_sweep(&self, sweep_id: &str) -> Result<Option<AssessmentSweepRow>>;
    fn record_run(&self, row: &AssessmentRunRow) -> Result<()>;
    fn record_finding(&self, row: &AssessmentFindingRow) -> Result<()>;
    fn record_sweep(&self, row: &AssessmentSweepRow) -> Result<()>;
}

pub struct AssessmentIndex {
    conn: Mutex<Connection>,
}

impl std::fmt::Debug for AssessmentIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssessmentIndex").finish_non_exhaustive()
    }
}

impl AssessmentIndex {
    /// Open (or create) an index file. The parent directory is expected to
    /// already exist; the bridge creates `$XDG_DATA_HOME/vac-web/bridge/`
    /// on startup before instantiating any persistence layer.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        let index = Self {
            conn: Mutex::new(conn),
        };
        index.migrate()?;
        Ok(index)
    }

    /// Open an in-memory index for unit tests and ephemeral hot caches.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let index = Self {
            conn: Mutex::new(conn),
        };
        index.migrate()?;
        Ok(index)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| AssessmentIndexError::Poisoned)
    }

    /// Apply migrations up to [`ASSESSMENT_INDEX_SCHEMA_VERSION`]. Re-running
    /// is idempotent.
    pub fn migrate(&self) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                 version INTEGER PRIMARY KEY
             );",
        )?;
        let stored: u32 = tx
            .query_row(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);

        if stored > ASSESSMENT_INDEX_SCHEMA_VERSION {
            return Err(AssessmentIndexError::UnsupportedSchema {
                stored,
                expected: ASSESSMENT_INDEX_SCHEMA_VERSION,
            });
        }

        if stored < 1 {
            tx.execute_batch(
                "CREATE TABLE assessment_runs (
                     run_id TEXT PRIMARY KEY,
                     session_id TEXT NOT NULL,
                     swarm TEXT NOT NULL,
                     status TEXT NOT NULL,
                     started_at TEXT NOT NULL,
                     completed_at TEXT,
                     verdict TEXT,
                     payload_json TEXT NOT NULL
                 );
                 CREATE INDEX idx_runs_session ON assessment_runs(session_id);
                 CREATE INDEX idx_runs_swarm_started ON assessment_runs(swarm, started_at DESC);

                 CREATE TABLE assessment_findings (
                     finding_id TEXT PRIMARY KEY,
                     run_id TEXT NOT NULL REFERENCES assessment_runs(run_id) ON DELETE CASCADE,
                     identity_hash TEXT NOT NULL,
                     severity TEXT NOT NULL,
                     category TEXT NOT NULL,
                     emitted_at TEXT NOT NULL,
                     payload_json TEXT NOT NULL
                 );
                 CREATE INDEX idx_findings_run ON assessment_findings(run_id);
                 CREATE INDEX idx_findings_hash ON assessment_findings(identity_hash);

                 CREATE TABLE assessment_sweeps (
                     sweep_id TEXT PRIMARY KEY,
                     session_id TEXT NOT NULL,
                     status TEXT NOT NULL,
                     started_at TEXT NOT NULL,
                     completed_at TEXT,
                     families_csv TEXT NOT NULL,
                     payload_json TEXT NOT NULL
                 );
                 CREATE INDEX idx_sweeps_session ON assessment_sweeps(session_id);",
            )?;
            tx.execute(
                "INSERT INTO schema_version(version) VALUES (?1)",
                params![1u32],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<u32> {
        let conn = self.lock()?;
        let v = conn
            .query_row(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get::<_, u32>(0),
            )
            .optional()?
            .unwrap_or(0);
        Ok(v)
    }

    /// Summarize the current index contents for `assessment.index.status`.
    pub fn status(&self) -> Result<AssessmentIndexStatus> {
        let conn = self.lock()?;
        let schema_version = conn
            .query_row(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get::<_, u32>(0),
            )
            .optional()?
            .unwrap_or(0);
        let runs = conn.query_row("SELECT COUNT(*) FROM assessment_runs", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
        let findings = conn.query_row("SELECT COUNT(*) FROM assessment_findings", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
        let sweeps = conn.query_row("SELECT COUNT(*) FROM assessment_sweeps", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
        let last_indexed_at = conn
            .query_row(
                r#"SELECT ts FROM (
                     SELECT started_at AS ts FROM assessment_runs
                     UNION ALL SELECT completed_at AS ts FROM assessment_runs WHERE completed_at IS NOT NULL
                     UNION ALL SELECT emitted_at AS ts FROM assessment_findings
                     UNION ALL SELECT started_at AS ts FROM assessment_sweeps
                     UNION ALL SELECT completed_at AS ts FROM assessment_sweeps WHERE completed_at IS NOT NULL
                 ) ORDER BY ts DESC LIMIT 1"#,
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        Ok(AssessmentIndexStatus {
            schema_version,
            runs,
            findings,
            sweeps,
            last_indexed_at,
        })
    }

    /// Rebuild the cache from canonical persisted events.
    ///
    /// The work happens inside a single SQLite transaction so a failure
    /// leaves the previously indexed rows intact.
    pub fn rebuild_from_events(
        &self,
        events: &[PersistedServerEvent],
    ) -> Result<AssessmentIndexStatus> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM assessment_findings;
             DELETE FROM assessment_runs;
             DELETE FROM assessment_sweeps;",
        )?;
        for event in events {
            record_event(&tx, event)?;
        }
        tx.commit()?;
        drop(conn);
        self.status()
    }

    pub fn record_run(&self, row: &AssessmentRunRow) -> Result<()> {
        let conn = self.lock()?;
        record_run_with_conn(&conn, row)
    }

    pub fn record_finding(&self, row: &AssessmentFindingRow) -> Result<()> {
        let conn = self.lock()?;
        record_finding_with_conn(&conn, row)
    }

    pub fn record_sweep(&self, row: &AssessmentSweepRow) -> Result<()> {
        let conn = self.lock()?;
        record_sweep_with_conn(&conn, row)
    }

    /// List the most recent runs (newest first), optionally filtered by
    /// session and/or swarm.
    pub fn list_runs(
        &self,
        session_id: Option<&str>,
        swarm: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AssessmentRunRow>> {
        let conn = self.lock()?;
        let limit_i = if limit == 0 { -1 } else { limit as i64 };
        let mut sql = String::from(
            "SELECT run_id, session_id, swarm, status, started_at, completed_at, verdict, payload_json \
             FROM assessment_runs WHERE 1=1",
        );
        let mut bound: Vec<String> = Vec::new();
        if let Some(s) = session_id {
            sql.push_str(" AND session_id = ?");
            bound.push(s.to_string());
        }
        if let Some(s) = swarm {
            sql.push_str(" AND swarm = ?");
            bound.push(s.to_string());
        }
        sql.push_str(" ORDER BY started_at DESC LIMIT ?");
        let mut params_dyn: Vec<&dyn rusqlite::ToSql> =
            bound.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        params_dyn.push(&limit_i);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |row| {
            Ok(AssessmentRunRow {
                run_id: row.get(0)?,
                session_id: row.get(1)?,
                swarm: row.get(2)?,
                status: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                verdict: row.get(6)?,
                payload_json: row.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<AssessmentRunRow>> {
        let conn = self.lock()?;
        get_run_with_conn(&conn, run_id)
    }

    pub fn list_findings(&self, run_id: &str) -> Result<Vec<AssessmentFindingRow>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT finding_id, run_id, identity_hash, severity, category, emitted_at, payload_json \
             FROM assessment_findings WHERE run_id = ?1 ORDER BY emitted_at ASC",
        )?;
        let rows = stmt.query_map(params![run_id], |row| {
            Ok(AssessmentFindingRow {
                finding_id: row.get(0)?,
                run_id: row.get(1)?,
                identity_hash: row.get(2)?,
                severity: row.get(3)?,
                category: row.get(4)?,
                emitted_at: row.get(5)?,
                payload_json: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_sweep(&self, sweep_id: &str) -> Result<Option<AssessmentSweepRow>> {
        let conn = self.lock()?;
        get_sweep_with_conn(&conn, sweep_id)
    }

    /// List the most recent sweeps (newest first), optionally filtered by
    /// session. Family filtering is intentionally left to callers because
    /// `families_csv` is a denormalized compact summary.
    pub fn list_sweeps(
        &self,
        session_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AssessmentSweepRow>> {
        let conn = self.lock()?;
        let limit_i = if limit == 0 { -1 } else { limit as i64 };
        let mut sql = String::from(
            "SELECT sweep_id, session_id, status, started_at, completed_at, families_csv, payload_json \
             FROM assessment_sweeps WHERE 1=1",
        );
        let mut bound: Vec<String> = Vec::new();
        if let Some(s) = session_id {
            sql.push_str(" AND session_id = ?");
            bound.push(s.to_string());
        }
        sql.push_str(" ORDER BY started_at DESC LIMIT ?");
        let mut params_dyn: Vec<&dyn rusqlite::ToSql> =
            bound.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        params_dyn.push(&limit_i);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |row| {
            Ok(AssessmentSweepRow {
                sweep_id: row.get(0)?,
                session_id: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
                families_csv: row.get(5)?,
                payload_json: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Wipe every row but keep schema_version. Used by tests and by the
    /// `assessment.flush_index` admin command (introduced in P3.2).
    pub fn truncate_all(&self) -> Result<()> {
        let conn = self.lock()?;
        truncate_all_with_conn(&conn)
    }
}

impl AssessmentIndexStore for AssessmentIndex {
    fn get_run(&self, run_id: &str) -> Result<Option<AssessmentRunRow>> {
        AssessmentIndex::get_run(self, run_id)
    }

    fn get_sweep(&self, sweep_id: &str) -> Result<Option<AssessmentSweepRow>> {
        AssessmentIndex::get_sweep(self, sweep_id)
    }

    fn record_run(&self, row: &AssessmentRunRow) -> Result<()> {
        AssessmentIndex::record_run(self, row)
    }

    fn record_finding(&self, row: &AssessmentFindingRow) -> Result<()> {
        AssessmentIndex::record_finding(self, row)
    }

    fn record_sweep(&self, row: &AssessmentSweepRow) -> Result<()> {
        AssessmentIndex::record_sweep(self, row)
    }
}

impl<'conn> AssessmentIndexStore for Transaction<'conn> {
    fn get_run(&self, run_id: &str) -> Result<Option<AssessmentRunRow>> {
        get_run_with_conn(self, run_id)
    }

    fn get_sweep(&self, sweep_id: &str) -> Result<Option<AssessmentSweepRow>> {
        get_sweep_with_conn(self, sweep_id)
    }

    fn record_run(&self, row: &AssessmentRunRow) -> Result<()> {
        record_run_with_conn(self, row)
    }

    fn record_finding(&self, row: &AssessmentFindingRow) -> Result<()> {
        record_finding_with_conn(self, row)
    }

    fn record_sweep(&self, row: &AssessmentSweepRow) -> Result<()> {
        record_sweep_with_conn(self, row)
    }
}

fn record_run_with_conn(conn: &Connection, row: &AssessmentRunRow) -> Result<()> {
    conn.execute(
        "INSERT INTO assessment_runs(run_id, session_id, swarm, status, started_at, completed_at, verdict, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(run_id) DO UPDATE SET
             session_id = excluded.session_id,
             swarm = excluded.swarm,
             status = excluded.status,
             started_at = excluded.started_at,
             completed_at = excluded.completed_at,
             verdict = excluded.verdict,
             payload_json = excluded.payload_json",
        params![
            row.run_id,
            row.session_id,
            row.swarm,
            row.status,
            row.started_at,
            row.completed_at,
            row.verdict,
            row.payload_json,
        ],
    )?;
    Ok(())
}

fn record_finding_with_conn(conn: &Connection, row: &AssessmentFindingRow) -> Result<()> {
    conn.execute(
        "INSERT INTO assessment_findings(finding_id, run_id, identity_hash, severity, category, emitted_at, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(finding_id) DO UPDATE SET
             run_id = excluded.run_id,
             identity_hash = excluded.identity_hash,
             severity = excluded.severity,
             category = excluded.category,
             emitted_at = excluded.emitted_at,
             payload_json = excluded.payload_json",
        params![
            row.finding_id,
            row.run_id,
            row.identity_hash,
            row.severity,
            row.category,
            row.emitted_at,
            row.payload_json,
        ],
    )?;
    Ok(())
}

fn record_sweep_with_conn(conn: &Connection, row: &AssessmentSweepRow) -> Result<()> {
    conn.execute(
        "INSERT INTO assessment_sweeps(sweep_id, session_id, status, started_at, completed_at, families_csv, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(sweep_id) DO UPDATE SET
             session_id = excluded.session_id,
             status = excluded.status,
             started_at = excluded.started_at,
             completed_at = excluded.completed_at,
             families_csv = excluded.families_csv,
             payload_json = excluded.payload_json",
        params![
            row.sweep_id,
            row.session_id,
            row.status,
            row.started_at,
            row.completed_at,
            row.families_csv,
            row.payload_json,
        ],
    )?;
    Ok(())
}

fn get_run_with_conn(conn: &Connection, run_id: &str) -> Result<Option<AssessmentRunRow>> {
    conn.query_row(
        "SELECT run_id, session_id, swarm, status, started_at, completed_at, verdict, payload_json \
         FROM assessment_runs WHERE run_id = ?1",
        params![run_id],
        |row| {
            Ok(AssessmentRunRow {
                run_id: row.get(0)?,
                session_id: row.get(1)?,
                swarm: row.get(2)?,
                status: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                verdict: row.get(6)?,
                payload_json: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn get_sweep_with_conn(conn: &Connection, sweep_id: &str) -> Result<Option<AssessmentSweepRow>> {
    conn.query_row(
        "SELECT sweep_id, session_id, status, started_at, completed_at, families_csv, payload_json \
         FROM assessment_sweeps WHERE sweep_id = ?1",
        params![sweep_id],
        |row| {
            Ok(AssessmentSweepRow {
                sweep_id: row.get(0)?,
                session_id: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
                families_csv: row.get(5)?,
                payload_json: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn truncate_all_with_conn(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DELETE FROM assessment_findings;
         DELETE FROM assessment_runs;
         DELETE FROM assessment_sweeps;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_row(run_id: &str, swarm: &str, status: &str) -> AssessmentRunRow {
        AssessmentRunRow {
            run_id: run_id.to_string(),
            session_id: "sess-1".to_string(),
            swarm: swarm.to_string(),
            status: status.to_string(),
            started_at: "2026-05-01T00:00:00Z".to_string(),
            completed_at: None,
            verdict: None,
            payload_json: "{}".to_string(),
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        assert_eq!(
            idx.schema_version().unwrap(),
            ASSESSMENT_INDEX_SCHEMA_VERSION
        );
        // Re-running should not change the version or fail.
        idx.migrate().unwrap();
        idx.migrate().unwrap();
        assert_eq!(
            idx.schema_version().unwrap(),
            ASSESSMENT_INDEX_SCHEMA_VERSION
        );
    }

    #[test]
    fn record_and_get_run_roundtrip() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        idx.record_run(&run_row("r1", "rtd", "running")).unwrap();
        let got = idx.get_run("r1").unwrap().expect("row");
        assert_eq!(got.swarm, "rtd");
        assert_eq!(got.status, "running");
        assert!(idx.get_run("missing").unwrap().is_none());
    }

    #[test]
    fn record_run_upsert_overwrites_status() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        idx.record_run(&run_row("r1", "rtd", "running")).unwrap();
        let mut updated = run_row("r1", "rtd", "completed");
        updated.completed_at = Some("2026-05-01T00:01:00Z".into());
        updated.verdict = Some("pass".into());
        idx.record_run(&updated).unwrap();
        let got = idx.get_run("r1").unwrap().unwrap();
        assert_eq!(got.status, "completed");
        assert_eq!(got.verdict.as_deref(), Some("pass"));
    }

    #[test]
    fn list_runs_filters_and_orders() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        let mut a = run_row("r1", "rtd", "completed");
        a.started_at = "2026-05-01T00:00:00Z".into();
        let mut b = run_row("r2", "rtd", "completed");
        b.started_at = "2026-05-02T00:00:00Z".into();
        let mut c = run_row("r3", "security", "running");
        c.started_at = "2026-05-03T00:00:00Z".into();
        idx.record_run(&a).unwrap();
        idx.record_run(&b).unwrap();
        idx.record_run(&c).unwrap();

        let all = idx.list_runs(None, None, 0).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].run_id, "r3");
        assert_eq!(all[2].run_id, "r1");

        let rtd = idx.list_runs(None, Some("rtd"), 0).unwrap();
        assert_eq!(rtd.len(), 2);
        assert!(rtd.iter().all(|r| r.swarm == "rtd"));

        let limited = idx.list_runs(None, None, 2).unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn findings_cascade_on_run_delete() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        idx.record_run(&run_row("r1", "rtd", "completed")).unwrap();
        idx.record_finding(&AssessmentFindingRow {
            finding_id: "f1".into(),
            run_id: "r1".into(),
            identity_hash: "h1".into(),
            severity: "high".into(),
            category: "technical".into(),
            emitted_at: "2026-05-01T00:00:01Z".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        assert_eq!(idx.list_findings("r1").unwrap().len(), 1);
        // PRAGMA foreign_keys is OFF by default in rusqlite, so we test
        // the truncate path instead.
        idx.truncate_all().unwrap();
        assert!(idx.list_findings("r1").unwrap().is_empty());
        assert!(idx.get_run("r1").unwrap().is_none());
    }

    #[test]
    fn sweep_roundtrip() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        idx.record_sweep(&AssessmentSweepRow {
            sweep_id: "s1".into(),
            session_id: "sess-1".into(),
            status: "running".into(),
            started_at: "2026-05-01T00:00:00Z".into(),
            completed_at: None,
            families_csv: "rtd,security".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        let got = idx.get_sweep("s1").unwrap().unwrap();
        assert_eq!(got.families_csv, "rtd,security");
        assert_eq!(got.status, "running");
    }

    #[test]
    fn list_sweeps_filters_and_orders() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        idx.record_sweep(&AssessmentSweepRow {
            sweep_id: "old".into(),
            session_id: "sess-a".into(),
            status: "completed".into(),
            started_at: "2026-01-01T00:00:00Z".into(),
            completed_at: Some("2026-01-01T00:00:05Z".into()),
            families_csv: "rtd,pm".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        idx.record_sweep(&AssessmentSweepRow {
            sweep_id: "new".into(),
            session_id: "sess-a".into(),
            status: "running".into(),
            started_at: "2026-01-02T00:00:00Z".into(),
            completed_at: None,
            families_csv: "security".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        idx.record_sweep(&AssessmentSweepRow {
            sweep_id: "other".into(),
            session_id: "sess-b".into(),
            status: "running".into(),
            started_at: "2026-01-03T00:00:00Z".into(),
            completed_at: None,
            families_csv: "rtd".into(),
            payload_json: "{}".into(),
        })
        .unwrap();

        let rows = idx.list_sweeps(Some("sess-a"), 0).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.sweep_id.as_str()).collect::<Vec<_>>(),
            vec!["new", "old"]
        );
        let limited = idx.list_sweeps(Some("sess-a"), 1).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].sweep_id, "new");
    }

    #[test]
    fn rejects_unsupported_future_schema() {
        let idx = AssessmentIndex::open_in_memory().unwrap();
        {
            let conn = idx.lock().unwrap();
            conn.execute(
                "INSERT INTO schema_version(version) VALUES (?1)",
                params![ASSESSMENT_INDEX_SCHEMA_VERSION + 5],
            )
            .unwrap();
        }
        let err = idx.migrate().unwrap_err();
        assert!(matches!(
            err,
            AssessmentIndexError::UnsupportedSchema { .. }
        ));
    }
}
