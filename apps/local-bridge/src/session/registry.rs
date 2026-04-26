//! Registry of active sessions keyed by session_id.

use super::handle::{SessionHandle, SessionHandleRef, SpawnOptions};
use crate::agent_runtime::{synth_legacy_registry, AgentRuntimeRegistry};
use crate::audit::AuditFacility;
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::info;

#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<DashMap<String, SessionHandleRef>>,
    agents: Arc<AgentRuntimeRegistry>,
    /// Optional audit sink. Set once via [`attach_audit`] after AppState
    /// constructs the AuditFacility, so the X.5c.2 tool-activity path
    /// can write `tool.observed` / `tool.updated` / `tool.failed` rows
    /// without piping through the translator.
    audit: Arc<OnceLock<Arc<AuditFacility>>>,
}

impl SessionRegistry {
    /// Back-compat constructor preserved for existing callers (tests +
    /// older embeddings) that still hand a single engine binary path.
    /// Delegates to [`agent_runtime::synth_legacy_registry`], which
    /// infers the kind from the binary file name (e.g. `mock-engine`
    /// → `Mock`) so the spawn path is identical to pre-X.1 *and* the
    /// kind metadata is accurate for upcoming X.2 policy enforcement.
    pub fn new(engine_bin: PathBuf) -> Self {
        Self::with_runtime(Arc::new(synth_legacy_registry(engine_bin)))
    }

    /// Stage X.1 constructor: bridge owns an `AgentRuntimeRegistry`
    /// loaded from config, and SessionRegistry just borrows it.
    pub fn with_runtime(agents: Arc<AgentRuntimeRegistry>) -> Self {
        let reg = Self {
            inner: Arc::new(DashMap::new()),
            agents,
            audit: Arc::new(OnceLock::new()),
        };
        reg.spawn_reaper();
        reg
    }

    /// Stage X.5c.2 — attach the AppState's audit handle so spawned
    /// sessions can write tool-activity audit rows. Idempotent: safe
    /// to call multiple times with the same Arc; subsequent different
    /// values are silently ignored (tests rely on first-wins).
    pub fn attach_audit(&self, audit: Arc<AuditFacility>) {
        let _ = self.audit.set(audit);
    }

    pub fn agents(&self) -> &AgentRuntimeRegistry {
        &self.agents
    }

    pub async fn create(
        &self,
        profile_id: String,
        project_root: PathBuf,
    ) -> anyhow::Result<SessionHandleRef> {
        self.create_with_agent(profile_id, project_root, None).await
    }

    /// Stage X.4 entry point: optional `agent_id` selects a specific
    /// agent from the registry. `None` falls back to the registry's
    /// `default_agent` for compatibility with pre-X.4 callers and old
    /// `session.create` payloads that don't carry the field.
    pub async fn create_with_agent(
        &self,
        profile_id: String,
        project_root: PathBuf,
        agent_id: Option<&str>,
    ) -> anyhow::Result<SessionHandleRef> {
        self.create_with_agent_and_workflow(profile_id, project_root, agent_id, None)
            .await
    }

    /// Workflow-selection entry point: optional `workflow_id` picks the
    /// spec for the session's WorkflowProcess. `None` uses the registry
    /// default. An unknown `workflow_id` is handled by the caller (who
    /// should emit `workflow.not_found`) and `None` is passed here to
    /// use the default.
    pub async fn create_with_agent_and_workflow(
        &self,
        profile_id: String,
        project_root: PathBuf,
        agent_id: Option<&str>,
        workflow_id: Option<String>,
    ) -> anyhow::Result<SessionHandleRef> {
        let session_id = format!("sess_{}", ulid::Ulid::new());
        let agent = match agent_id {
            Some(id) => self
                .agents
                .get(id)
                .cloned()
                .map_err(|e| anyhow::anyhow!("{e}"))?,
            None => self.agents.default_agent().clone(),
        };
        // Lower-level guard: even if a future caller bypasses the
        // translator's `agent.disabled` ack, the registry itself must
        // refuse to spawn a disabled agent.
        if !agent.enabled {
            anyhow::bail!("agent.disabled: agent `{}` is disabled", agent.id);
        }
        let opts = SpawnOptions {
            session_id: session_id.clone(),
            profile_id,
            project_root,
            agent,
            audit: self.audit.get().cloned(),
            workflow_id,
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
