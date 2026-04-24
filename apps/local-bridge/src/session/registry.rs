//! Registry of active sessions keyed by session_id.

use super::handle::{SessionHandle, SessionHandleRef, SpawnOptions};
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;

#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<DashMap<String, SessionHandleRef>>,
    pub default_engine_bin: PathBuf,
}

impl SessionRegistry {
    pub fn new(engine_bin: PathBuf) -> Self {
        let reg = Self {
            inner: Arc::new(DashMap::new()),
            default_engine_bin: engine_bin,
        };
        reg.spawn_reaper();
        reg
    }

    pub async fn create(
        &self,
        profile_id: String,
        project_root: PathBuf,
    ) -> anyhow::Result<SessionHandleRef> {
        let session_id = format!("sess_{}", ulid::Ulid::new());
        let opts = SpawnOptions {
            session_id: session_id.clone(),
            profile_id,
            project_root,
            engine_bin: self.default_engine_bin.clone(),
        };
        let handle = SessionHandle::spawn(opts).await?;
        self.inner.insert(session_id.clone(), Arc::clone(&handle));
        info!(%session_id, total = self.inner.len(), "session created");
        Ok(handle)
    }

    pub fn get(&self, session_id: &str) -> Option<SessionHandleRef> {
        self.inner.get(session_id).map(|r| Arc::clone(r.value()))
    }

    pub fn count(&self) -> usize {
        self.inner.len()
    }

    pub fn remove(&self, session_id: &str) -> Option<SessionHandleRef> {
        let out = self.inner.remove(session_id).map(|(_, v)| v);
        if out.is_some() {
            info!(%session_id, remaining = self.inner.len(), "session removed");
        }
        out
    }

    pub fn list(&self) -> Vec<String> {
        self.inner.iter().map(|r| r.key().clone()).collect()
    }

    /// Background task reaps sessions whose state reached `Closed` (child exited or
    /// user closed). Cheap: ticks every 2s, O(n) scan.
    fn spawn_reaper(&self) {
        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(2));
            loop {
                ticker.tick().await;
                let to_drop: Vec<String> = inner
                    .iter()
                    .filter(|r| r.value().state.current().is_terminal())
                    .map(|r| r.key().clone())
                    .collect();
                for sid in to_drop {
                    if inner.remove(&sid).is_some() {
                        info!(session = %sid, "reaper: removed terminal session");
                    }
                }
            }
        });
    }
}
