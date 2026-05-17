//! Non-blocking append-only JSONL audit writer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tracing::warn;

/// Maximum length permitted for a `session_id` embedded in an audit filename.
///
/// Keeps audit filenames bounded even if upstream code mints unexpectedly
/// long ids. Picked to comfortably exceed ULIDs (26 chars), UUIDs (36 chars),
/// and prefixed variants while still fitting well under typical filesystem
/// `NAME_MAX` (255).
pub const MAX_AUDIT_SESSION_ID_LEN: usize = 128;

/// Validates that `session_id` is safe to embed in an audit filename of the
/// form `<session_id>.jsonl`.
///
/// Returns `Ok(())` only when the id matches `[A-Za-z0-9._-]{1,128}` and is
/// not the path traversal segments `.` or `..`. Empty ids, path separators
/// (`/`, `\`), control bytes, non-ASCII characters, traversal segments, and
/// over-long ids are all rejected. The audit writer drops entries whose
/// `session_id` fails this check so a malicious or buggy id cannot make the
/// writer touch files outside its configured `dir`.
pub fn validate_audit_session_id(session_id: &str) -> Result<(), &'static str> {
    if session_id.is_empty() {
        return Err("session_id is empty");
    }
    if session_id.len() > MAX_AUDIT_SESSION_ID_LEN {
        return Err("session_id exceeds MAX_AUDIT_SESSION_ID_LEN");
    }
    if session_id == "." || session_id == ".." {
        return Err("session_id is a path traversal segment");
    }
    for c in session_id.chars() {
        let allowed = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !allowed {
            return Err("session_id contains disallowed character");
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditSeverity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: DateTime<Utc>,
    pub session_id: String,
    pub subsystem: String,
    pub severity: AuditSeverity,
    pub fields: serde_json::Value,
}

impl AuditEntry {
    pub fn new(session_id: impl Into<String>, subsystem: impl Into<String>) -> Self {
        Self {
            ts: Utc::now(),
            session_id: session_id.into(),
            subsystem: subsystem.into(),
            severity: AuditSeverity::Info,
            fields: serde_json::json!({}),
        }
    }
    pub fn severity(mut self, s: AuditSeverity) -> Self {
        self.severity = s;
        self
    }
    pub fn fields(mut self, fields: serde_json::Value) -> Self {
        self.fields = fields;
        self
    }
}

#[derive(Debug, Clone)]
pub struct AuditConfig {
    pub dir: PathBuf,
    pub channel_cap: usize,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            dir: PathBuf::from("/tmp/vac-web/audit"),
            channel_cap: 8192,
        }
    }
}

/// Non-blocking JSONL writer. Overflow → drop + counter increment; no backpressure.
pub struct AuditWriter {
    tx: mpsc::Sender<AuditEntry>,
    dropped: Arc<AtomicU64>,
}

impl AuditWriter {
    pub fn spawn(config: AuditConfig) -> Self {
        let (tx, rx) = mpsc::channel(config.channel_cap);
        let dropped = Arc::new(AtomicU64::new(0));
        std::fs::create_dir_all(&config.dir).ok();
        tokio::spawn(writer_task(rx, config));
        Self { tx, dropped }
    }

    pub fn log(&self, entry: AuditEntry) {
        if self.tx.try_send(entry).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

async fn writer_task(mut rx: mpsc::Receiver<AuditEntry>, config: AuditConfig) {
    use std::collections::HashMap;
    let mut files: HashMap<String, tokio::fs::File> = HashMap::new();

    while let Some(entry) = rx.recv().await {
        if let Err(reason) = validate_audit_session_id(&entry.session_id) {
            // S07-F01: refuse to derive an audit filename from an untrusted
            // session_id that contains path separators / traversal / control
            // bytes / non-ASCII / over-length input. Drop the entry rather
            // than risk writing outside `config.dir`.
            warn!(
                reason = %reason,
                session_id_len = entry.session_id.len(),
                "audit drop: invalid session_id for filename"
            );
            continue;
        }
        let path = config.dir.join(format!("{}.jsonl", entry.session_id));
        let file = match files.get_mut(&entry.session_id) {
            Some(f) => f,
            None => {
                match tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .await
                {
                    Ok(f) => {
                        // `get_or_insert_with`-style pattern: the insert we
                        // just performed guarantees the entry exists. `.expect`
                        // here narrows the panic scope + documents the invariant.
                        files.insert(entry.session_id.clone(), f);
                        files
                            .get_mut(&entry.session_id)
                            .expect("just-inserted session audit file handle")
                    }
                    Err(e) => {
                        warn!(error = %e, "audit open failed");
                        continue;
                    }
                }
            }
        };
        let mut line = match serde_json::to_vec(&entry) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "audit serialize failed");
                continue;
            }
        };
        line.push(b'\n');
        if let Err(e) = file.write_all(&line).await {
            warn!(error = %e, "audit write failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty_session_id() {
        assert!(validate_audit_session_id("").is_err());
    }

    #[test]
    fn validate_rejects_forward_slash() {
        assert!(validate_audit_session_id("a/b").is_err());
        assert!(validate_audit_session_id("../x").is_err());
        assert!(validate_audit_session_id("/etc/passwd").is_err());
        assert!(validate_audit_session_id("sess/01").is_err());
    }

    #[test]
    fn validate_rejects_back_slash() {
        assert!(validate_audit_session_id("a\\b").is_err());
        assert!(validate_audit_session_id("..\\x").is_err());
    }

    #[test]
    fn validate_rejects_traversal_segments() {
        assert!(validate_audit_session_id(".").is_err());
        assert!(validate_audit_session_id("..").is_err());
    }

    #[test]
    fn validate_rejects_null_byte() {
        assert!(validate_audit_session_id("a\0b").is_err());
    }

    #[test]
    fn validate_rejects_control_chars() {
        assert!(validate_audit_session_id("a\nb").is_err());
        assert!(validate_audit_session_id("a\tb").is_err());
        assert!(validate_audit_session_id("a\rb").is_err());
    }

    #[test]
    fn validate_rejects_over_long_session_id() {
        let too_long = "a".repeat(MAX_AUDIT_SESSION_ID_LEN + 1);
        assert!(validate_audit_session_id(&too_long).is_err());
        let at_limit = "a".repeat(MAX_AUDIT_SESSION_ID_LEN);
        assert!(validate_audit_session_id(&at_limit).is_ok());
        let just_under = "a".repeat(MAX_AUDIT_SESSION_ID_LEN - 1);
        assert!(validate_audit_session_id(&just_under).is_ok());
    }

    #[test]
    fn validate_accepts_ulid_and_uuid_like_session_ids() {
        assert!(validate_audit_session_id("01HXYZABCDEFG").is_ok());
        assert!(validate_audit_session_id("sess_01HXYZ-ABCDE.f").is_ok());
        assert!(validate_audit_session_id("00000000-0000-0000-0000-000000000000").is_ok());
        assert!(validate_audit_session_id("a").is_ok());
        assert!(validate_audit_session_id("A-Z_0-9.test").is_ok());
    }

    #[test]
    fn validate_rejects_non_ascii() {
        // Non-ASCII unicode (e.g. visually similar latin-extended or cyrillic
        // chars) is refused so audit filenames stay strictly ASCII.
        assert!(validate_audit_session_id("abc\u{0301}").is_err());
        assert!(validate_audit_session_id("\u{0430}bc").is_err()); // cyrillic 'a'
        assert!(validate_audit_session_id("sess\u{2022}01").is_err());
    }

    #[test]
    fn validate_rejects_other_path_metacharacters() {
        assert!(validate_audit_session_id("a b").is_err());
        assert!(validate_audit_session_id("a:b").is_err());
        assert!(validate_audit_session_id("a;b").is_err());
        assert!(validate_audit_session_id("a*b").is_err());
        assert!(validate_audit_session_id("a?b").is_err());
        assert!(validate_audit_session_id("a|b").is_err());
    }
}
