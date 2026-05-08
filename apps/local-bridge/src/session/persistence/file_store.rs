//! File-backed persistence (JSONL v1).
//!
//! Layout:
//!
//! ```text
//! root/
//!   <vac_session_id>/
//!     meta.json     -- single JSON object, atomically rewritten via tmp+rename
//!     events.jsonl  -- append-only JSON-lines stream
//! ```
//!
//! `list()` walks the root directory on each call so an externally
//! deleted or partially-restored session set is always reflected
//! accurately. There is no central index file by design — one less
//! thing to keep consistent across crashes.

use super::error::{PersistenceError, PersistenceResult};
use super::model::{
    PersistedServerEvent, PersistedSessionMeta, PersistedSessionStatus, SessionHistoryFilter,
};
use super::SessionPersistence;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const META_FILENAME: &str = "meta.json";
const EVENTS_FILENAME: &str = "events.jsonl";

/// File-backed [`SessionPersistence`].
pub struct FilePersistence {
    root: PathBuf,
    /// Coarse mutex serialises mutating operations so concurrent
    /// callers can't interleave a JSONL line. Reads are lock-free.
    write_lock: Mutex<()>,
}

impl FilePersistence {
    /// Open or create a persistence root. Missing parents are created.
    pub fn open(root: impl Into<PathBuf>) -> PersistenceResult<Self> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            write_lock: Mutex::new(()),
        })
    }

    /// Resolve the bridge's default storage root.
    ///
    /// Order of precedence:
    /// 1. `VAC_SESSIONS_DIR` env var (escape hatch for tests / packaging)
    /// 2. `$XDG_DATA_HOME/vac-web/bridge/sessions`
    /// 3. `$HOME/.local/share/vac-web/bridge/sessions`
    /// 4. `./.vac/sessions` (last-resort relative path)
    pub fn default_root() -> PathBuf {
        if let Ok(explicit) = std::env::var("VAC_SESSIONS_DIR") {
            if !explicit.is_empty() {
                return PathBuf::from(explicit);
            }
        }
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("vac-web/bridge/sessions");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".local/share/vac-web/bridge/sessions");
        }
        PathBuf::from("./.vac/sessions")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn session_dir(&self, vac_session_id: &str) -> PersistenceResult<PathBuf> {
        if !is_safe_session_id(vac_session_id) {
            return Err(PersistenceError::InvalidSessionId(
                vac_session_id.to_string(),
            ));
        }
        Ok(self.root.join(vac_session_id))
    }

    fn ensure_session_dir(&self, vac_session_id: &str) -> PersistenceResult<PathBuf> {
        let dir = self.session_dir(vac_session_id)?;
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

/// Reject path-traversal-shaped ids and anything that wouldn't make a
/// safe directory name. The bridge generates `sess_<ulid>` so the
/// realistic input is always a clean ASCII alnum/underscore/hyphen
/// string.
fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() < 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl SessionPersistence for FilePersistence {
    fn save_meta(&self, meta: &PersistedSessionMeta) -> PersistenceResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .expect("persistence write_lock poisoned");
        let dir = self.ensure_session_dir(&meta.vac_session_id)?;
        let path = dir.join(META_FILENAME);
        let tmp = dir.join(format!("{META_FILENAME}.tmp"));
        let bytes = serde_json::to_vec_pretty(meta)?;
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    fn load_meta(&self, vac_session_id: &str) -> PersistenceResult<Option<PersistedSessionMeta>> {
        let path = self.session_dir(vac_session_id)?.join(META_FILENAME);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(&path)?;
        let meta: PersistedSessionMeta =
            serde_json::from_slice(&bytes).map_err(|e| PersistenceError::CorruptMeta {
                path: path.display().to_string(),
                reason: e.to_string(),
            })?;
        Ok(Some(meta))
    }

    fn list(&self, filter: &SessionHistoryFilter) -> PersistenceResult<Vec<PersistedSessionMeta>> {
        let mut out: Vec<PersistedSessionMeta> = Vec::new();
        let read = match fs::read_dir(&self.root) {
            Ok(it) => it,
            // Treat a missing root the same as an empty one — the
            // bridge can boot before anyone has called save_meta.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e.into()),
        };
        for entry in read {
            let entry = entry?;
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if !file_type.is_dir() {
                continue;
            }
            let path = entry.path().join(META_FILENAME);
            if !path.exists() {
                continue;
            }
            let bytes = match fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            // List is forgiving: a single corrupt row should not lock
            // the whole UI out. `load_meta` is the strict path.
            let meta: PersistedSessionMeta = match serde_json::from_slice(&bytes) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !filter_match(filter, &meta) {
                continue;
            }
            out.push(meta);
        }
        out.sort_by_key(|m| std::cmp::Reverse(m.updated_at));
        if let Some(limit) = filter.limit {
            out.truncate(limit);
        }
        Ok(out)
    }

    fn append_event(
        &self,
        vac_session_id: &str,
        event: &PersistedServerEvent,
    ) -> PersistenceResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .expect("persistence write_lock poisoned");
        let dir = self.ensure_session_dir(vac_session_id)?;
        let path = dir.join(EVENTS_FILENAME);
        let mut writer = BufWriter::new(OpenOptions::new().create(true).append(true).open(&path)?);
        serde_json::to_writer(&mut writer, event)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
        Ok(())
    }

    fn load_events(
        &self,
        vac_session_id: &str,
        limit: usize,
    ) -> PersistenceResult<Vec<PersistedServerEvent>> {
        let path = self.session_dir(vac_session_id)?.join(EVENTS_FILENAME);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let file = File::open(&path)?;
        let reader = BufReader::new(file);
        let mut out: Vec<PersistedServerEvent> = Vec::new();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            // Skip corrupt lines instead of failing — partial JSONL
            // after a crash is the common failure mode and we'd
            // rather show *some* history than none.
            if let Ok(ev) = serde_json::from_str::<PersistedServerEvent>(&line) {
                out.push(ev);
            }
        }
        if limit > 0 && out.len() > limit {
            let drop = out.len() - limit;
            out.drain(0..drop);
        }
        Ok(out)
    }

    fn mark_status(
        &self,
        vac_session_id: &str,
        status: PersistedSessionStatus,
    ) -> PersistenceResult<()> {
        let mut meta = self
            .load_meta(vac_session_id)?
            .ok_or_else(|| PersistenceError::NotFound(vac_session_id.to_string()))?;
        meta.status = status;
        meta.updated_at = chrono::Utc::now();
        self.save_meta(&meta)
    }

    fn forget(&self, vac_session_id: &str) -> PersistenceResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .expect("persistence write_lock poisoned");
        let dir = self.session_dir(vac_session_id)?;
        if !dir.exists() {
            return Ok(());
        }
        fs::remove_dir_all(&dir)?;
        Ok(())
    }
}

fn filter_match(filter: &SessionHistoryFilter, meta: &PersistedSessionMeta) -> bool {
    if let Some(root) = &filter.project_root {
        if meta.project_root != *root {
            return false;
        }
    }
    if let Some(agent) = &filter.agent_id {
        if &meta.agent_id != agent {
            return false;
        }
    }
    if let Some(status) = filter.status {
        if meta.status != status {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::persistence::model::{
        PersistedServerEvent, PersistedSessionMeta, PersistenceNativeResume, PersistenceVersion,
        RedactionLabel, PERSISTENCE_VERSION,
    };
    use chrono::Utc;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn meta(id: &str, project: &str) -> PersistedSessionMeta {
        let now = Utc::now();
        PersistedSessionMeta {
            version: PersistenceVersion(PERSISTENCE_VERSION),
            vac_session_id: id.to_string(),
            agent_session_id: Some("agent_abc".to_string()),
            agent_id: "opencode-acp".to_string(),
            agent_kind: "acp".to_string(),
            project_root: PathBuf::from(project),
            profile_id: "executor-code".to_string(),
            workflow_id: Some("build-basic".to_string()),
            created_at: now,
            updated_at: now,
            status: PersistedSessionStatus::Active,
            native_resume: PersistenceNativeResume::default(),
            mcp_servers: vec![],
            agent_capabilities: serde_json::json!({"loadSession": true}),
            // Stage R2 — mirror what spawn_acp / spawn_mock now
            // record at `session/new` time. The shipped
            // `executor-code` profile parses to class `executor`.
            profile_class: Some("executor".to_string()),
        }
    }

    fn evt(seq: u64, ty: &str) -> PersistedServerEvent {
        PersistedServerEvent {
            seq,
            event_type: ty.to_string(),
            payload: serde_json::json!({"hello": "world"}),
            ts: Utc::now(),
            redaction: RedactionLabel::Safe,
        }
    }

    #[test]
    fn persistence_saves_and_loads_meta() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        let m = meta("sess_test_001", "/proj/a");
        store.save_meta(&m).unwrap();
        let loaded = store.load_meta("sess_test_001").unwrap().unwrap();
        assert_eq!(loaded.vac_session_id, m.vac_session_id);
        assert_eq!(loaded.profile_id, m.profile_id);
        assert_eq!(loaded.status, PersistedSessionStatus::Active);
        assert_eq!(loaded.version, PersistenceVersion(PERSISTENCE_VERSION));
    }

    #[test]
    fn persistence_load_meta_missing_returns_none() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        assert!(store.load_meta("sess_unknown").unwrap().is_none());
    }

    #[test]
    fn persistence_lists_by_project() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        store.save_meta(&meta("sess_a", "/proj/a")).unwrap();
        store.save_meta(&meta("sess_b", "/proj/b")).unwrap();
        store.save_meta(&meta("sess_c", "/proj/a")).unwrap();

        let only_a = store
            .list(&SessionHistoryFilter {
                project_root: Some(PathBuf::from("/proj/a")),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(only_a.len(), 2);
        assert!(only_a
            .iter()
            .all(|m| m.project_root == Path::new("/proj/a")));

        let limited = store
            .list(&SessionHistoryFilter {
                limit: Some(2),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn persistence_appends_events_in_order() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        store.save_meta(&meta("sess_evt", "/p")).unwrap();
        for i in 0..5 {
            store
                .append_event("sess_evt", &evt(i, "test.event"))
                .unwrap();
        }
        let events = store.load_events("sess_evt", 0).unwrap();
        assert_eq!(events.len(), 5);
        for (i, e) in events.iter().enumerate() {
            assert_eq!(e.seq, i as u64);
            assert_eq!(e.event_type, "test.event");
        }
        let tail = store.load_events("sess_evt", 2).unwrap();
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].seq, 3);
        assert_eq!(tail[1].seq, 4);
    }

    #[test]
    fn persistence_skips_corrupt_event_lines() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        store.save_meta(&meta("sess_partial", "/p")).unwrap();
        store.append_event("sess_partial", &evt(1, "a")).unwrap();
        // Inject garbage between two valid rows.
        let path = tmp.path().join("sess_partial").join(EVENTS_FILENAME);
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "not json").unwrap();
        store.append_event("sess_partial", &evt(2, "b")).unwrap();
        let events = store.load_events("sess_partial", 0).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].seq, 1);
        assert_eq!(events[1].seq, 2);
    }

    #[test]
    fn persistence_rejects_invalid_session_id() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        let err = store.load_meta("../escape").unwrap_err();
        assert!(matches!(err, PersistenceError::InvalidSessionId(_)));
    }

    #[test]
    fn persistence_rejects_corrupt_meta() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        let dir = tmp.path().join("sess_corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(META_FILENAME), b"{not json").unwrap();
        let err = store.load_meta("sess_corrupt").unwrap_err();
        assert!(matches!(err, PersistenceError::CorruptMeta { .. }));
    }

    #[test]
    fn persistence_list_skips_corrupt_meta() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        store.save_meta(&meta("sess_ok", "/p")).unwrap();
        // Inject a corrupt sibling.
        let bad = tmp.path().join("sess_bad");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join(META_FILENAME), b"{not json").unwrap();
        let listed = store.list(&SessionHistoryFilter::default()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].vac_session_id, "sess_ok");
    }

    #[test]
    fn persistence_forget_removes_session_dir() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        store.save_meta(&meta("sess_gone", "/p")).unwrap();
        store.append_event("sess_gone", &evt(1, "x")).unwrap();
        assert!(tmp.path().join("sess_gone").exists());
        store.forget("sess_gone").unwrap();
        assert!(!tmp.path().join("sess_gone").exists());
        assert!(store.load_meta("sess_gone").unwrap().is_none());
    }

    #[test]
    fn persistence_forget_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        // Forgetting a never-saved session must not error.
        store.forget("sess_never").unwrap();
    }

    #[test]
    fn persistence_mark_status_updates_timestamp() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        let m = meta("sess_status", "/p");
        store.save_meta(&m).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        store
            .mark_status("sess_status", PersistedSessionStatus::Closed)
            .unwrap();
        let after = store.load_meta("sess_status").unwrap().unwrap();
        assert_eq!(after.status, PersistedSessionStatus::Closed);
        assert!(after.updated_at >= m.updated_at);
    }

    #[test]
    fn persistence_mark_status_missing_errors() {
        let tmp = TempDir::new().unwrap();
        let store = FilePersistence::open(tmp.path()).unwrap();
        let err = store
            .mark_status("sess_missing", PersistedSessionStatus::Closed)
            .unwrap_err();
        assert!(matches!(err, PersistenceError::NotFound(_)));
    }
}
