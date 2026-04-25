//! Registry of active sessions keyed by session_id.

use super::handle::{SessionHandle, SessionHandleRef, SpawnOptions};
use crate::agent_runtime::{
    AgentDefinition, AgentKind, AgentRuntimeRegistry, AgentsConfig, ConfigSource,
    DEFAULT_PERMISSION_TIMEOUT_MS,
};
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;

#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<DashMap<String, SessionHandleRef>>,
    agents: Arc<AgentRuntimeRegistry>,
}

impl SessionRegistry {
    /// Back-compat constructor preserved for existing callers (tests +
    /// older embeddings) that still hand a single engine binary path.
    /// Internally synthesizes a one-agent runtime registry classified
    /// as `vac-native` so the spawn path looks identical to pre-X.1.
    pub fn new(engine_bin: PathBuf) -> Self {
        let agents = Arc::new(synth_single_agent_registry(engine_bin));
        Self::with_runtime(agents)
    }

    /// Stage X.1 constructor: bridge owns an `AgentRuntimeRegistry`
    /// loaded from config, and SessionRegistry just borrows it.
    pub fn with_runtime(agents: Arc<AgentRuntimeRegistry>) -> Self {
        let reg = Self {
            inner: Arc::new(DashMap::new()),
            agents,
        };
        reg.spawn_reaper();
        reg
    }

    pub fn agents(&self) -> &AgentRuntimeRegistry {
        &self.agents
    }

    pub async fn create(
        &self,
        profile_id: String,
        project_root: PathBuf,
    ) -> anyhow::Result<SessionHandleRef> {
        let session_id = format!("sess_{}", ulid::Ulid::new());
        let agent = self.agents.default_agent().clone();
        let opts = SpawnOptions {
            session_id: session_id.clone(),
            profile_id,
            project_root,
            agent,
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

/// Build a single-agent runtime registry from a raw binary path. Used
/// only by the back-compat `SessionRegistry::new(PathBuf)` shim — every
/// new caller should hand in a real `AgentRuntimeRegistry`.
fn synth_single_agent_registry(engine_bin: PathBuf) -> AgentRuntimeRegistry {
    let id = "default".to_string();
    let agent = AgentDefinition {
        id: id.clone(),
        label: "Default engine".into(),
        kind: AgentKind::VacNative,
        command: engine_bin,
        args: vec!["--stdio".into()],
        enabled: true,
        permission_timeout_ms: DEFAULT_PERMISSION_TIMEOUT_MS,
    };
    let cfg = AgentsConfig {
        default_agent_id: id,
        agents: vec![agent],
    };
    AgentRuntimeRegistry::from_config(cfg, ConfigSource::Embedded)
}
