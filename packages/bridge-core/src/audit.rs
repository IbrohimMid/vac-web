//! Non-blocking append-only JSONL audit writer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tracing::warn;

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
