//! Registry of active sessions keyed by session_id.

use super::handle::{SessionHandle, SessionHandleRef, SpawnOptions};
use crate::agent_runtime::{synth_legacy_registry, AgentRuntimeRegistry};
use crate::audit::AuditFacility;
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::RwLock;
use std::time::Duration;
use tracing::info;

#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<DashMap<String, SessionHandleRef>>,
    /// Audit P3: wrapped in `RwLock` so `registry.reload` can
    /// atomically swap in a freshly-parsed `AgentRuntimeRegistry`
    /// without restarting the bridge. Reads clone the inner `Arc`
    /// under a brief shared lock, so existing in-flight calls keep
    /// the snapshot they captured.
    agents: Arc<RwLock<Arc<AgentRuntimeRegistry>>>,
    /// Optional audit sink. Set once via [`attach_audit`] after AppState
    /// constructs the AuditFacility, so the X.5c.2 tool-activity path
    /// can write `tool.observed` / `tool.updated` / `tool.failed` rows
    /// without piping through the translator.
    audit: Arc<OnceLock<Arc<AuditFacility>>>,
    /// Path to capability profile YAMLs. Threaded into SpawnOptions so
    /// the ACP spawn path can load the profile for fs/terminal enforcement.
    profile_root: PathBuf,
}

impl SessionRegistry {
    /// Back-compat constructor preserved for existing callers (tests +
    /// older embeddings) that still hand a single engine binary path.
    pub fn new(engine_bin: PathBuf) -> Self {
        Self::with_runtime(Arc::new(synth_legacy_registry(engine_bin)))
    }

    /// Stage X.1 constructor: bridge owns an `AgentRuntimeRegistry`
    /// loaded from config, and SessionRegistry just borrows it.
    pub fn with_runtime(agents: Arc<AgentRuntimeRegistry>) -> Self {
        Self::with_runtime_and_profiles(agents, PathBuf::from("packages/protocol/v1/profiles"))
    }

    pub fn with_runtime_and_profiles(
        agents: Arc<AgentRuntimeRegistry>,
        profile_root: PathBuf,
    ) -> Self {
        let reg = Self {
            inner: Arc::new(DashMap::new()),
            agents: Arc::new(RwLock::new(agents)),
            audit: Arc::new(OnceLock::new()),
            profile_root,
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

    /// Snapshot the active agent registry as an `Arc`. Cheap: takes a
    /// shared lock briefly, clones the inner `Arc`, drops the lock.
    /// Existing snapshots remain valid even after `reload_agents`
    /// swaps in a fresh registry.
    pub fn agents(&self) -> Arc<AgentRuntimeRegistry> {
        Arc::clone(&*self.agents.read().expect("agents RwLock poisoned"))
    }

    /// Audit P3: re-read the on-disk `agents.toml` and atomically swap
    /// the live registry. Errors propagate from
    /// `AgentRuntimeRegistry::load`; on success the previous snapshot
    /// continues to work for any caller that already cloned it.
    /// Returns the freshly-installed registry for the caller to inspect
    /// (e.g. to re-broadcast a welcome frame).
    pub fn reload_agents(
        &self,
    ) -> crate::agent_runtime::AgentRuntimeResult<Arc<AgentRuntimeRegistry>> {
        let fresh = Arc::new(AgentRuntimeRegistry::load()?);
        let mut slot = self.agents.write().expect("agents RwLock poisoned");
        *slot = Arc::clone(&fresh);
        info!(
            source = %fresh.source().describe(),
            default_agent = %fresh.default_agent().id,
            "agent runtime registry hot-reloaded"
        );
        Ok(fresh)
    }

    /// Test-only hook: install an arbitrary registry without going
    /// through `AgentRuntimeRegistry::load`. Lets unit tests verify
    /// snapshot semantics without touching the filesystem.
    #[cfg(test)]
    pub fn replace_agents_for_test(&self, fresh: Arc<AgentRuntimeRegistry>) {
        let mut slot = self.agents.write().expect("agents RwLock poisoned");
        *slot = fresh;
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
        let snapshot = self.agents();
        let agent = match agent_id {
            Some(id) => snapshot
                .get(id)
                .cloned()
                .map_err(|e| anyhow::anyhow!("{e}"))?,
            None => snapshot.default_agent().clone(),
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
            profile_root: self.profile_root.clone(),
        };
        let handle = SessionHandle::spawn(opts).await?;
        self.inner.insert(session_id.clone(), Arc::clone(&handle));
        info!(%session_id, total = self.inner.len(), "session created");
        Ok(handle)
    }

    pub fn get(&self, session_id: &str) -> Option<SessionHandleRef> {
        self.inner.get(session_id).map(|r| Arc::clone(r.value()))
    }

    pub fn project_root(&self, session_id: &str) -> Option<std::path::PathBuf> {
        self.get(session_id).map(|h| h.project_root.clone())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::{AgentsConfig, ConfigSource};
    use std::path::Path;

    fn registry_from(toml_src: &str) -> Arc<AgentRuntimeRegistry> {
        let cfg = AgentsConfig::from_toml_str(toml_src, Path::new("<test>")).unwrap();
        Arc::new(AgentRuntimeRegistry::from_config(
            cfg,
            ConfigSource::Embedded,
        ))
    }

    /// Audit P3: snapshots taken before `replace_agents_for_test` keep
    /// pointing at the original registry, while a fresh `agents()` call
    /// returns the swapped-in one.
    #[tokio::test]
    async fn agents_snapshot_outlives_swap() {
        let initial = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "mock"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(Arc::clone(&initial));

        let snap_before = registry.agents();
        assert_eq!(snap_before.default_agent().id, "alpha");

        let updated = registry_from(
            r#"
            default_agent_id = "beta"
            [agents.beta]
            label = "Beta"
            kind = "mock"
            command = "/bin/true"
            "#,
        );
        registry.replace_agents_for_test(Arc::clone(&updated));

        // Snapshot taken before the swap still resolves the original.
        assert_eq!(snap_before.default_agent().id, "alpha");
        // Fresh snapshot reflects the swap.
        let snap_after = registry.agents();
        assert_eq!(snap_after.default_agent().id, "beta");
    }

    /// Audit P3: clones of `SessionRegistry` share the same `RwLock`,
    /// so a swap on one clone is visible to the other (matches how
    /// `AppState` hands the registry around).
    #[tokio::test]
    async fn agents_swap_is_visible_through_clones() {
        let initial = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "mock"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(Arc::clone(&initial));
        let cloned = registry.clone();

        let updated = registry_from(
            r#"
            default_agent_id = "gamma"
            [agents.gamma]
            label = "Gamma"
            kind = "mock"
            command = "/bin/true"
            "#,
        );
        registry.replace_agents_for_test(updated);

        assert_eq!(cloned.agents().default_agent().id, "gamma");
    }
}
