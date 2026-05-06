//! Registry of active sessions keyed by session_id.

use super::handle::{NativeResumeRequest, SessionHandle, SessionHandleRef, SpawnOptions};
use super::persistence::{
    PersistedSessionMeta, PersistenceHealth, RedactionMode, SharedPersistence,
};
use crate::agent_runtime::acp::client::LoadSessionError;
use crate::agent_runtime::{synth_legacy_registry, AgentRuntimeRegistry};
use crate::audit::AuditFacility;
use crate::handoff::packet::{Packet, PacketStatus};
use dashmap::DashMap;
use profile_core::enforce::{enforce_agent_kind, Decision};
use profile_core::profile::CapabilityProfile;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::RwLock;
use std::time::Duration;
use tracing::info;

/// Stage X6 4-4 — outcome of `SessionRegistry::resume_native`. The
/// translator's dispatch maps each variant to either a `session.resumed`
/// event (Started) or a specific `session.resume.failed { reason }`
/// event. `Unsupported` is special-cased: callers in `native_or_replay`
/// mode treat it as a graceful fallback to persistence replay.
///
/// Note: `Started` carries a `SessionHandleRef` (which is
/// `Arc<SessionHandle>`) and `SessionHandle` does not implement
/// `Debug`, so this enum opts out of `#[derive(Debug)]`.
pub enum ResumeNativeOutcome {
    /// `session/load` succeeded; the bridge has live pumps + handle.
    /// Stage R2 — `warnings` carries non-blocking validation
    /// notices accumulated during pre-spawn checks (e.g. a legacy
    /// meta missing `profile_class`). The translator emits a
    /// `session.resume.warning` for each entry before forwarding
    /// the resume lifecycle events.
    Started {
        handle: SessionHandleRef,
        warnings: Vec<ResumeValidationWarning>,
    },
    /// Agent's `initialize` advertised loadSession=true but the
    /// `session/load` RPC came back with method-not-found / unsupported.
    /// Callers in `native_or_replay` mode should fall back to replay.
    Unsupported,
    /// Agent rejected the load (e.g. unknown session_id, expired
    /// transcript). Carries the agent's error message verbatim.
    Rejected(String),
    /// Anything else — child crashed during init, anyhow chain didn't
    /// carry a `LoadSessionError`, IO error, etc.
    Failed(String),
    /// Pre-spawn validation against the live registry / persisted meta
    /// rejected the request. No child was spawned.
    Validation(ResumeValidationFailure),
}

/// Stage R2 — non-blocking validation notice accumulated during
/// pre-spawn checks. Each variant maps to a `session.resume.warning`
/// reason on the wire; the resume itself proceeds.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ResumeValidationWarning {
    /// Persisted meta predates Stage R2 and has no `profile_class`
    /// recorded. The bridge can't compare it against the live profile,
    /// so we surface a non-blocking warning and continue resume.
    ProfileClassMissing,
}

impl ResumeValidationWarning {
    /// Wire reason string for `session.resume.warning.reason`.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::ProfileClassMissing => "profile_class_missing",
        }
    }
}

/// Stage X6 4-4 — specific pre-spawn validation failures. Each
/// variant maps 1:1 to a `session.resume.failed.reason` string on
/// the wire so the frontend can localize the message.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ResumeValidationFailure {
    /// `meta.agent_id` is no longer present in the live agent registry
    /// (or is disabled).
    AgentNotInRegistry,
    /// Live agent's `kind` differs from `meta.agent_kind`. The session
    /// can't be safely resumed against a different runtime.
    AgentKindMismatch,
    /// `meta.profile_id` is empty / unresolvable.
    ProfileNotFound,
    /// Stage X6 batch C2 — the profile YAML exists on disk but
    /// failed to parse / pass `CapabilityProfile::load` validation.
    /// We hard-fail here rather than letting `spawn_acp` silently
    /// fall back to a restrictive default profile that would yield
    /// confusing `fs.read_disabled` denials downstream.
    ProfileInvalid,
    /// Stage X6 batch C3 — the loaded profile no longer permits
    /// the persisted session's `agent_kind` (operator changed
    /// `allowed_agent_kinds` between session creation and resume).
    /// We refuse to resume against a profile that wouldn't have
    /// allowed the session in the first place.
    AgentKindNotAllowed,
    /// `meta.project_root` no longer exists or isn't reachable.
    ProjectRootUnavailable,
    /// `meta.agent_session_id` is `None` — the session never reached
    /// `session/new` so there's nothing for `session/load` to target.
    VacSessionUnknown,
    /// Stage R2 — the persisted `profile_class` differs from the
    /// current parsed profile's `class`. The session was created
    /// against a profile whose semantic class (e.g. `assessor`) has
    /// since changed (e.g. to `executor`). Hard-fail by default; the
    /// R3 policy `profile_class_mismatch` may downgrade this to a
    /// warning at a later stage.
    ProfileClassMismatch,
}

impl ResumeValidationFailure {
    /// Wire reason string. Mirrors the failure-reason catalog from
    /// the Stage X6 plan.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::AgentNotInRegistry => "agent_not_in_registry",
            Self::AgentKindMismatch => "agent_kind_mismatch",
            Self::ProfileNotFound => "profile_not_found",
            Self::ProfileInvalid => "profile_invalid",
            Self::AgentKindNotAllowed => "agent_kind_not_allowed",
            Self::ProjectRootUnavailable => "project_root_unavailable",
            Self::VacSessionUnknown => "vac_session_unknown",
            Self::ProfileClassMismatch => "profile_class_mismatch",
        }
    }
}

/// Pass E2 — typed failure modes for [`SessionRegistry::spawn_executor_for_handoff`].
///
/// Each variant carries enough context for the WS dispatcher to surface a
/// `handoff.dispatch_failed { code, reason }` event without re-deriving the
/// wire reason in two places.
#[derive(Debug)]
pub enum ExecutorSpawnError {
    /// Packet status was not `Approved` when spawn was attempted.
    NotApproved { actual: String },
    /// `target.executor_profile_id` was empty / whitespace-only.
    MissingExecutorProfile,
    /// Packet had no tasks to execute.
    EmptyTaskList,
    /// `project_root` no longer points at a real directory.
    ProjectRootMissing { path: String },
    /// Pin was incomplete or expired at spawn time.
    PinInvalid { reason: String },
    /// Profile YAML failed to load / parse.
    ProfileInvalid { profile_id: String, detail: String },
    /// Profile loaded but its `class` is not `executor`.
    ProfileNotExecutor {
        profile_id: String,
        actual_class: String,
    },
    /// Caller supplied an `agent_id` that is not in the live agent registry.
    AgentNotInRegistry { agent_id: String },
    /// Live agent's `kind` is not in the profile's `allowed_agent_kinds`.
    AgentKindNotAllowed { agent_kind: String, reason: String },
    /// Underlying `SessionRegistry::create_with_agent_and_workflow` failed.
    SpawnFailed { detail: String },
}

impl ExecutorSpawnError {
    /// Stable wire code for `handoff.dispatch_failed.code`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotApproved { .. } => "handoff.not_approved",
            Self::MissingExecutorProfile => "handoff.missing_executor_profile",
            Self::EmptyTaskList => "handoff.empty_task_list",
            Self::ProjectRootMissing { .. } => "handoff.project_root_unavailable",
            Self::PinInvalid { .. } => "handoff.pin_invalid",
            Self::ProfileInvalid { .. } => "handoff.profile_invalid",
            Self::ProfileNotExecutor { .. } => "handoff.profile_not_executor",
            Self::AgentNotInRegistry { .. } => "handoff.agent_not_in_registry",
            Self::AgentKindNotAllowed { .. } => "handoff.agent_kind_not_allowed",
            Self::SpawnFailed { .. } => "handoff.spawn_failed",
        }
    }

    /// Short tag for `state_history.reason` and audit logs.
    pub fn reason_tag(&self) -> &'static str {
        match self {
            Self::NotApproved { .. } => "not_approved",
            Self::MissingExecutorProfile => "missing_executor_profile",
            Self::EmptyTaskList => "empty_task_list",
            Self::ProjectRootMissing { .. } => "project_root_unavailable",
            Self::PinInvalid { .. } => "pin_invalid",
            Self::ProfileInvalid { .. } => "profile_invalid",
            Self::ProfileNotExecutor { .. } => "profile_not_executor",
            Self::AgentNotInRegistry { .. } => "agent_not_in_registry",
            Self::AgentKindNotAllowed { .. } => "agent_kind_not_allowed",
            Self::SpawnFailed { .. } => "spawn_failed",
        }
    }

    /// Human-readable message for `handoff.dispatch_failed.message`.
    pub fn message(&self) -> String {
        match self {
            Self::NotApproved { actual } => {
                format!("packet must be approved before spawn, got status={actual}")
            }
            Self::MissingExecutorProfile => "target.executor_profile_id is empty".to_string(),
            Self::EmptyTaskList => "packet has no tasks".to_string(),
            Self::ProjectRootMissing { path } => {
                format!("project_root does not exist: {path}")
            }
            Self::PinInvalid { reason } => reason.clone(),
            Self::ProfileInvalid { profile_id, detail } => {
                format!("profile {profile_id} failed to load: {detail}")
            }
            Self::ProfileNotExecutor {
                profile_id,
                actual_class,
            } => format!("profile {profile_id} has class={actual_class}, expected executor"),
            Self::AgentNotInRegistry { agent_id } => {
                format!("agent {agent_id} is not in the live registry")
            }
            Self::AgentKindNotAllowed { agent_kind, reason } => {
                format!("agent kind {agent_kind} not allowed by profile: {reason}")
            }
            Self::SpawnFailed { detail } => format!("session spawn failed: {detail}"),
        }
    }
}

impl std::fmt::Display for ExecutorSpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for ExecutorSpawnError {}

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
    /// Phase 2 persistence: optional file-backed (or in-memory test)
    /// `SessionPersistence` impl. Threaded into every spawned session
    /// via `SpawnOptions` so `session/new` metadata + `ServerEvent`
    /// records land in the durable transcript. `None` means persistence
    /// is disabled and sessions run with the in-memory ring + broadcast
    /// only.
    persistence: Arc<OnceLock<SharedPersistence>>,
    /// Stage X6 P2-B — cheap-clone process-global persistence health
    /// signal. Threaded into every spawned [`SessionHandle`] via
    /// [`SpawnOptions::persistence_health`] so an `append_event` /
    /// `save_meta` failure flips the shared flag visible to the
    /// translator's `session.history.list` arm.
    persistence_health: Arc<OnceLock<PersistenceHealth>>,
    /// Phase N1 — optional SQLite cache index for assessment.* events.
    /// Threaded into every spawned [`SessionHandle`] via
    /// [`SpawnOptions::assessment_index`] so the per-session
    /// [`PersistenceSink`] can mirror assessment events to the index
    /// after the JSONL append. Idempotent setter mirrors
    /// `attach_persistence` / `attach_persistence_health`.
    assessment_index: Arc<OnceLock<Arc<crate::storage::AssessmentIndex>>>,
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
            persistence: Arc::new(OnceLock::new()),
            persistence_health: Arc::new(OnceLock::new()),
            assessment_index: Arc::new(OnceLock::new()),
        };
        reg.spawn_reaper();
        reg
    }

    /// Phase 2 — attach the AppState's persistence handle so spawned
    /// sessions can write durable `session/new` metadata + replayable
    /// `ServerEvent` rows. Idempotent: subsequent calls with different
    /// values are silently ignored (mirrors `attach_audit`).
    pub fn attach_persistence(&self, persistence: SharedPersistence) {
        let _ = self.persistence.set(persistence);
    }

    /// Stage X6 P2-B — attach the AppState's process-global persistence
    /// health handle. Idempotent: subsequent calls are silently ignored
    /// (mirrors `attach_persistence` / `attach_audit`). When unset (e.g.
    /// in tests or when persistence is disabled), spawned sessions get
    /// an isolated default health handle so failures are still tracked
    /// per-sink without leaking into other tests.
    pub fn attach_persistence_health(&self, health: PersistenceHealth) {
        let _ = self.persistence_health.set(health);
    }

    /// Snapshot the attached health handle, or a fresh default when
    /// nothing has been attached. Cheap clone of the inner `Arc`.
    pub fn persistence_health(&self) -> PersistenceHealth {
        self.persistence_health.get().cloned().unwrap_or_default()
    }

    /// Phase N1 — attach the AppState's SQLite cache index for
    /// assessment.* events. Idempotent: subsequent calls with different
    /// values are silently ignored (mirrors `attach_persistence` /
    /// `attach_persistence_health`). When unset (e.g. in tests, or when
    /// the index couldn't be opened on the host filesystem), spawned
    /// sessions skip the SQLite double-write entirely and rely on the
    /// JSONL log alone.
    pub fn attach_assessment_index(&self, index: Arc<crate::storage::AssessmentIndex>) {
        let _ = self.assessment_index.set(index);
    }

    /// Snapshot the attached assessment index handle. Cheap clone of the
    /// inner `Arc`. Returns `None` when no index has been attached —
    /// callers thread that through `SpawnOptions::assessment_index` so
    /// the per-session [`PersistenceSink`] knows to skip the
    /// double-write path.
    pub fn assessment_index(&self) -> Option<Arc<crate::storage::AssessmentIndex>> {
        self.assessment_index.get().cloned()
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

    #[cfg(test)]
    pub fn insert_for_test(&self, session_id: impl Into<String>, handle: SessionHandleRef) {
        self.inner.insert(session_id.into(), handle);
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
            persistence: self.persistence.get().cloned(),
            persistence_health: self.persistence_health(),
            redaction_mode: RedactionMode::Standard,
            resume_native: None,
            assessment_index: self.assessment_index(),
        };
        let handle = SessionHandle::spawn(opts).await?;
        self.inner.insert(session_id.clone(), Arc::clone(&handle));
        info!(%session_id, total = self.inner.len(), "session created");
        Ok(handle)
    }

    /// Stage X6 4-4 — native ACP `session/load` resume entry point.
    /// Validates the persisted meta against the live agent registry +
    /// trust policy, then asks `SessionHandle::spawn` to drive the
    /// pumps-before-load flow. Returns a typed outcome so the
    /// translator can emit the right `session.resume.failed` reason or
    /// fall back to persistence replay when the agent reports
    /// `LoadSessionUnsupported`.
    ///
    /// The caller is responsible for having already checked that
    /// `meta.native_resume.load_session_supported == true` (the
    /// translator does this in 4-3 dispatch). This method does NOT
    /// re-check that flag — it goes straight to spawn + load.
    pub async fn resume_native(
        &self,
        meta: &PersistedSessionMeta,
        mode: &'static str,
    ) -> ResumeNativeOutcome {
        // Step 2 — agent must still exist in the live registry.
        let snapshot = self.agents();
        let agent = match snapshot.get(&meta.agent_id) {
            Ok(a) => a.clone(),
            Err(_) => {
                return ResumeNativeOutcome::Validation(
                    ResumeValidationFailure::AgentNotInRegistry,
                );
            }
        };

        // Step 3 — agent_kind on the live snapshot must match what was
        // recorded at `session/new` time. Surface drift surfaces as a
        // hard failure so the operator can re-create the session
        // rather than silently load against a different runtime.
        if agent.kind.as_str() != meta.agent_kind {
            return ResumeNativeOutcome::Validation(ResumeValidationFailure::AgentKindMismatch);
        }

        // Step 5 — project_root must still be a directory the bridge
        // can address. (Trust-policy validation lives upstream in the
        // translator's `enforce_action` path; we only check existence
        // here.)
        if !meta.project_root.exists() {
            return ResumeNativeOutcome::Validation(
                ResumeValidationFailure::ProjectRootUnavailable,
            );
        }

        // Step 4 — strict profile validation. Stage X6 4-5 + batch C2/C3:
        // hard-fail here rather than let `SessionHandle::spawn_acp`
        // silently fall back to a restrictive default profile, which
        // yields confusing fs/terminal denials downstream.
        //
        // The validation tiers, in order of strictness:
        //   1. `meta.profile_id` must be non-empty.
        //   2. `<profile_root>/<profile_id>.yaml` must exist on disk.
        //   3. (C2) The YAML must parse + pass `CapabilityProfile::load`
        //      — i.e. the `inherits_from` chain resolves and the
        //      consistency invariants hold. A profile that exists but
        //      doesn't parse surfaces as `profile_invalid` rather
        //      than `profile_not_found`.
        //   4. (C3) The loaded profile's `allowed_agent_kinds` must
        //      include the persisted `agent_kind`. Operator narrowing
        //      `allowed_agent_kinds` between create and resume must
        //      surface as a clean `agent_kind_not_allowed` failure,
        //      not a stealth replay-time policy block.
        if meta.profile_id.is_empty() {
            return ResumeNativeOutcome::Validation(ResumeValidationFailure::ProfileNotFound);
        }
        let profile_path = self.profile_root.join(format!("{}.yaml", meta.profile_id));
        if !profile_path.exists() {
            return ResumeNativeOutcome::Validation(ResumeValidationFailure::ProfileNotFound);
        }
        let profile = match CapabilityProfile::load(&meta.profile_id, &self.profile_root) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(
                    profile = %meta.profile_id,
                    error = %e,
                    "resume_native: profile failed to parse; rejecting with profile_invalid"
                );
                return ResumeNativeOutcome::Validation(ResumeValidationFailure::ProfileInvalid);
            }
        };
        if let Decision::Deny { reason, .. } = enforce_agent_kind(&profile, &meta.agent_kind) {
            tracing::warn!(
                profile = %meta.profile_id,
                agent_kind = %meta.agent_kind,
                reason = %reason,
                "resume_native: profile no longer allows persisted agent kind"
            );
            return ResumeNativeOutcome::Validation(ResumeValidationFailure::AgentKindNotAllowed);
        }

        // Stage R2 — profile_class compatibility. Compare the snapshot
        // recorded at `session/new` time against the live class. Three
        // outcomes:
        //   * Both Some + equal      → pass through.
        //   * Both Some + different  → hard fail `profile_class_mismatch`.
        //   * Persisted None         → legacy meta predating R2; emit a
        //                              `profile_class_missing` warning
        //                              and continue.
        // The current profile's class is read from the parsed Rust
        // value (post `inherits_from` resolution + consistency check),
        // *not* the raw YAML field, so an attacker can't bypass the
        // gate by tweaking only the YAML.
        let live_class = serde_json::to_value(profile.class)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string));
        let mut warnings: Vec<ResumeValidationWarning> = Vec::new();
        match (meta.profile_class.as_deref(), live_class.as_deref()) {
            (Some(persisted), Some(live)) if persisted != live => {
                tracing::warn!(
                    profile = %meta.profile_id,
                    persisted_class = %persisted,
                    live_class = %live,
                    "resume_native: profile_class drift between session/new and resume"
                );
                return ResumeNativeOutcome::Validation(
                    ResumeValidationFailure::ProfileClassMismatch,
                );
            }
            (Some(_), Some(_)) => {
                // Classes match — nothing to do.
            }
            (None, _) => {
                // Legacy meta predating R2. Surface a non-blocking
                // warning so the operator notices, but continue.
                tracing::info!(
                    profile = %meta.profile_id,
                    vac_session = %meta.vac_session_id,
                    "resume_native: persisted meta has no profile_class; emitting profile_class_missing warning"
                );
                warnings.push(ResumeValidationWarning::ProfileClassMissing);
            }
            (Some(_), None) => {
                // We have a persisted class but couldn't read the live
                // one. The profile loaded successfully above, so this
                // shouldn't happen in practice; tolerate it as a
                // missing-class warning rather than a mismatch fail.
                tracing::warn!(
                    profile = %meta.profile_id,
                    "resume_native: live profile class not extractable; treating as missing"
                );
                warnings.push(ResumeValidationWarning::ProfileClassMissing);
            }
        }

        // Step 6–10 — spawn ACP child via existing flow with
        // `resume_native` set. `SessionHandle::spawn` reuses the
        // existing `vac_session_id` and replaces `session/new` with a
        // deferred `session/load` after pumps are live.
        let agent_session_id = match meta.agent_session_id.as_ref() {
            Some(id) => id.clone(),
            None => {
                return ResumeNativeOutcome::Validation(ResumeValidationFailure::VacSessionUnknown);
            }
        };
        if !agent.enabled {
            return ResumeNativeOutcome::Validation(ResumeValidationFailure::AgentNotInRegistry);
        }
        let opts = SpawnOptions {
            session_id: meta.vac_session_id.clone(),
            profile_id: meta.profile_id.clone(),
            project_root: meta.project_root.clone(),
            agent,
            audit: self.audit.get().cloned(),
            workflow_id: meta.workflow_id.clone(),
            profile_root: self.profile_root.clone(),
            persistence: self.persistence.get().cloned(),
            persistence_health: self.persistence_health(),
            redaction_mode: RedactionMode::Standard,
            resume_native: Some(NativeResumeRequest {
                vac_session_id: meta.vac_session_id.clone(),
                agent_session_id,
                mode,
            }),
            assessment_index: self.assessment_index(),
        };

        match SessionHandle::spawn(opts).await {
            Ok(handle) => {
                self.inner
                    .insert(meta.vac_session_id.clone(), Arc::clone(&handle));
                info!(
                    session_id = %meta.vac_session_id,
                    total = self.inner.len(),
                    warnings = warnings.len(),
                    "native resume succeeded"
                );
                // Stage R2 — forward any pre-spawn validation
                // warnings (e.g. legacy meta missing `profile_class`)
                // alongside the live handle so the translator can
                // emit `session.resume.warning` events before the
                // resume lifecycle stream.
                ResumeNativeOutcome::Started { handle, warnings }
            }
            Err(e) => match e.downcast::<LoadSessionError>() {
                Ok(LoadSessionError::Unsupported(_)) => ResumeNativeOutcome::Unsupported,
                Ok(LoadSessionError::Rejected(jr)) => ResumeNativeOutcome::Rejected(jr.message),
                Ok(LoadSessionError::Other(other)) => {
                    ResumeNativeOutcome::Failed(other.to_string())
                }
                Err(other) => ResumeNativeOutcome::Failed(other.to_string()),
            },
        }
    }

    /// Pass E2 — spawn an executor session bound to an approved handoff packet.
    ///
    /// All validation failures here are pre-spawn — no child process is
    /// started until every gate passes — so the caller can surface a clean
    /// `handoff.dispatch_failed` event without leaking a stranded child.
    pub async fn spawn_executor_for_handoff(
        &self,
        packet: &Packet,
        project_root: PathBuf,
        agent_id: Option<String>,
    ) -> Result<SessionHandleRef, ExecutorSpawnError> {
        // 1. Status gate — only `approved` packets may spawn.
        if packet.status != PacketStatus::Approved {
            return Err(ExecutorSpawnError::NotApproved {
                actual: packet.status.as_str().to_string(),
            });
        }

        // 2. Executor profile id must be a non-empty, trimmed string.
        let executor_profile_id = packet.target.executor_profile_id.trim();
        if executor_profile_id.is_empty() {
            return Err(ExecutorSpawnError::MissingExecutorProfile);
        }

        // 3. Tasks must be non-empty.
        if packet.tasks.is_empty() {
            return Err(ExecutorSpawnError::EmptyTaskList);
        }

        // 4. project_root must be a real directory.
        if !project_root.exists() {
            return Err(ExecutorSpawnError::ProjectRootMissing {
                path: project_root.display().to_string(),
            });
        }

        // 5. Pin must be complete and unexpired.
        if !packet.pin.is_complete() {
            return Err(ExecutorSpawnError::PinInvalid {
                reason: "pin is incomplete".to_string(),
            });
        }
        if packet.pin.is_expired() {
            return Err(ExecutorSpawnError::PinInvalid {
                reason: "pin has expired".to_string(),
            });
        }

        // 6. Load the executor profile. Hard-fail rather than letting
        //    `spawn_acp` silently fall back to a restrictive default.
        let profile =
            CapabilityProfile::load(executor_profile_id, &self.profile_root).map_err(|e| {
                ExecutorSpawnError::ProfileInvalid {
                    profile_id: executor_profile_id.to_string(),
                    detail: e.to_string(),
                }
            })?;

        // 7. Profile class must be `executor`. Compared via the serde
        //    string repr so the gate stays in sync with the wire vocabulary.
        let live_class = serde_json::to_value(profile.class)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string());
        if live_class != "executor" {
            return Err(ExecutorSpawnError::ProfileNotExecutor {
                profile_id: executor_profile_id.to_string(),
                actual_class: live_class,
            });
        }

        // 8. If a specific agent was requested, make sure it's in the
        //    registry and its kind is allowed by the profile.
        let snapshot = self.agents();
        let agent_id_opt: Option<String> = agent_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(ref id) = agent_id_opt {
            let agent = snapshot
                .get(id)
                .map_err(|_| ExecutorSpawnError::AgentNotInRegistry {
                    agent_id: id.clone(),
                })?;
            if let Decision::Deny { reason, .. } = enforce_agent_kind(&profile, agent.kind.as_str())
            {
                return Err(ExecutorSpawnError::AgentKindNotAllowed {
                    agent_kind: agent.kind.as_str().to_string(),
                    reason: reason.to_string(),
                });
            }
        }

        // 9. All gates passed — spawn through the existing entry point.
        self.create_with_agent_and_workflow(
            executor_profile_id.to_string(),
            project_root,
            agent_id_opt.as_deref(),
            None,
        )
        .await
        .map_err(|e| ExecutorSpawnError::SpawnFailed {
            detail: e.to_string(),
        })
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

    /// Stage X6 4-5 — build a `PersistedSessionMeta` with sane defaults
    /// for the validation tests below. Caller overrides only the field
    /// it cares about, so the assertion stays focused on the failure
    /// reason rather than the meta plumbing.
    fn meta_with(
        agent_id: &str,
        agent_kind: &str,
        project_root: PathBuf,
        profile_id: &str,
        agent_session_id: Option<&str>,
    ) -> PersistedSessionMeta {
        meta_with_class(
            agent_id,
            agent_kind,
            project_root,
            profile_id,
            agent_session_id,
            // Stage R2 — most existing tests load the shipped
            // `assessor` profile, so default the persisted class
            // to match. Tests that need to exercise the
            // `profile_class_missing` warning path call
            // `meta_with_class(.., None)` directly.
            Some("assessor"),
        )
    }

    /// Stage R2 — explicit-class variant of `meta_with` so tests can
    /// inject `profile_class: None` (legacy meta) or a deliberate
    /// mismatch without touching every other validation test.
    fn meta_with_class(
        agent_id: &str,
        agent_kind: &str,
        project_root: PathBuf,
        profile_id: &str,
        agent_session_id: Option<&str>,
        profile_class: Option<&str>,
    ) -> PersistedSessionMeta {
        use crate::session::persistence::{
            PersistedSessionStatus, PersistenceNativeResume, PersistenceVersion,
        };
        let now = chrono::Utc::now();
        PersistedSessionMeta {
            version: PersistenceVersion::default(),
            vac_session_id: "sess_native_test".to_string(),
            agent_session_id: agent_session_id.map(|s| s.to_string()),
            agent_id: agent_id.to_string(),
            agent_kind: agent_kind.to_string(),
            project_root,
            profile_id: profile_id.to_string(),
            workflow_id: None,
            created_at: now,
            updated_at: now,
            status: PersistedSessionStatus::Active,
            native_resume: PersistenceNativeResume {
                load_session_supported: true,
                last_verified_at: None,
            },
            mcp_servers: Vec::new(),
            agent_capabilities: serde_json::json!({}),
            profile_class: profile_class.map(str::to_string),
        }
    }

    /// Stage X6 4-5 — B4 validation grid for `resume_native`. Each
    /// case mutates exactly one field on a baseline meta and asserts
    /// the matching `ResumeValidationFailure` variant + wire reason
    /// string. No ACP child is spawned because each branch returns
    /// pre-spawn.
    #[tokio::test]
    async fn resume_native_validation_agent_not_in_registry() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(agents);
        let tmp = tempfile::tempdir().unwrap();
        let meta = meta_with(
            "ghost",
            "acp",
            tmp.path().to_path_buf(),
            "assessor",
            Some("agent_sess_x"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::AgentNotInRegistry);
                assert_eq!(f.reason(), "agent_not_in_registry");
            }
            _ => panic!("expected Validation(AgentNotInRegistry)"),
        }
    }

    #[tokio::test]
    async fn resume_native_validation_agent_kind_mismatch() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(agents);
        let tmp = tempfile::tempdir().unwrap();
        let meta = meta_with(
            "alpha",
            "mock", // drift: live agent is `acp`, persisted as `mock`
            tmp.path().to_path_buf(),
            "assessor",
            Some("agent_sess_x"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::AgentKindMismatch);
                assert_eq!(f.reason(), "agent_kind_mismatch");
            }
            _ => panic!("expected Validation(AgentKindMismatch)"),
        }
    }

    #[tokio::test]
    async fn resume_native_validation_project_root_unavailable() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(agents);
        let meta = meta_with(
            "alpha",
            "acp",
            PathBuf::from("/definitely/not/a/real/dir/for/native_resume_test"),
            "assessor",
            Some("agent_sess_x"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::ProjectRootUnavailable);
                assert_eq!(f.reason(), "project_root_unavailable");
            }
            _ => panic!("expected Validation(ProjectRootUnavailable)"),
        }
    }

    #[tokio::test]
    async fn resume_native_validation_profile_id_empty() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let registry = SessionRegistry::with_runtime(agents);
        let tmp = tempfile::tempdir().unwrap();
        let meta = meta_with(
            "alpha",
            "acp",
            tmp.path().to_path_buf(),
            "", // empty profile_id
            Some("agent_sess_x"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::ProfileNotFound);
                assert_eq!(f.reason(), "profile_not_found");
            }
            _ => panic!("expected Validation(ProfileNotFound) for empty profile_id"),
        }
    }

    #[tokio::test]
    async fn resume_native_validation_profile_file_missing() {
        // Stage X6 4-5 — strict profile validation: a profile_id that
        // doesn't resolve to a file under `profile_root` must hard-fail
        // here rather than silently fall back to the restrictive
        // profile inside `SessionHandle::spawn_acp`.
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let profile_root = tempfile::tempdir().unwrap();
        let registry =
            SessionRegistry::with_runtime_and_profiles(agents, profile_root.path().to_path_buf());
        let project_tmp = tempfile::tempdir().unwrap();
        let meta = meta_with(
            "alpha",
            "acp",
            project_tmp.path().to_path_buf(),
            "profile-that-does-not-exist",
            Some("agent_sess_x"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::ProfileNotFound);
                assert_eq!(f.reason(), "profile_not_found");
            }
            _ => panic!("expected Validation(ProfileNotFound) for missing profile file"),
        }
    }

    /// Stage R2 — mismatched persisted vs live `profile_class`
    /// must hard-fail with `profile_class_mismatch` BEFORE any
    /// child is spawned. Builds a profile fixture whose class is
    /// `assessor` but persists meta as if it were `executor`.
    #[tokio::test]
    async fn resume_native_validation_profile_class_mismatch() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let profile_root = tempfile::tempdir().unwrap();
        std::fs::write(
            profile_root.path().join("assessor.yaml"),
            "id: assessor\nclass: assessor\nversion: 0.0.0\nallowed_agent_kinds:\n  - acp\n",
        )
        .unwrap();
        let registry =
            SessionRegistry::with_runtime_and_profiles(agents, profile_root.path().to_path_buf());
        let project_tmp = tempfile::tempdir().unwrap();
        let meta = meta_with_class(
            "alpha",
            "acp",
            project_tmp.path().to_path_buf(),
            "assessor",
            Some("agent_sess_x"),
            Some("executor"), // drift: persisted as executor, profile is assessor
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::ProfileClassMismatch);
                assert_eq!(f.reason(), "profile_class_mismatch");
            }
            _ => panic!("expected Validation(ProfileClassMismatch)"),
        }
    }

    /// Stage R2 — a persisted meta with the same class as the live
    /// profile must clear the R2 gate. Reaches `vac_session_unknown`
    /// because `agent_session_id` is `None` (no need to spawn an
    /// actual child to assert the gate passed).
    #[tokio::test]
    async fn resume_native_validation_profile_class_match_passes_gate() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let profile_root = tempfile::tempdir().unwrap();
        std::fs::write(
            profile_root.path().join("assessor.yaml"),
            "id: assessor\nclass: assessor\nversion: 0.0.0\nallowed_agent_kinds:\n  - acp\n",
        )
        .unwrap();
        let registry =
            SessionRegistry::with_runtime_and_profiles(agents, profile_root.path().to_path_buf());
        let project_tmp = tempfile::tempdir().unwrap();
        let meta = meta_with_class(
            "alpha",
            "acp",
            project_tmp.path().to_path_buf(),
            "assessor",
            None, // forces VacSessionUnknown after the R2 gate
            Some("assessor"),
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                // Gate passed; downstream check tripped on missing
                // agent_session_id, which is the expected next failure.
                assert_eq!(f, ResumeValidationFailure::VacSessionUnknown);
            }
            _ => panic!("expected gate to pass and trip VacSessionUnknown"),
        }
    }

    /// Stage R2 — legacy meta missing `profile_class` must NOT fail
    /// the gate; the warning is accumulated and the resume continues
    /// to the next validation step. We assert by reaching
    /// `VacSessionUnknown` (downstream gate) with an absent persisted
    /// class — if the R2 gate had hard-failed we'd see
    /// `ProfileClassMismatch` instead.
    #[tokio::test]
    async fn resume_native_validation_profile_class_missing_does_not_fail_gate() {
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let profile_root = tempfile::tempdir().unwrap();
        std::fs::write(
            profile_root.path().join("assessor.yaml"),
            "id: assessor\nclass: assessor\nversion: 0.0.0\nallowed_agent_kinds:\n  - acp\n",
        )
        .unwrap();
        let registry =
            SessionRegistry::with_runtime_and_profiles(agents, profile_root.path().to_path_buf());
        let project_tmp = tempfile::tempdir().unwrap();
        let meta = meta_with_class(
            "alpha",
            "acp",
            project_tmp.path().to_path_buf(),
            "assessor",
            None,
            None, // legacy meta with no persisted class
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(ResumeValidationFailure::VacSessionUnknown) => {}
            other => panic!(
                "expected gate to pass and trip VacSessionUnknown, got {:?}",
                std::mem::discriminant(&other)
            ),
        }
    }

    #[tokio::test]
    async fn resume_native_validation_vac_session_unknown() {
        // `agent_session_id = None` means the persisted session never
        // reached `session/new`, so there's nothing for `session/load`
        // to target. We need a real profile file to get past the
        // profile gate and reach this branch.
        let agents = registry_from(
            r#"
            default_agent_id = "alpha"
            [agents.alpha]
            label = "Alpha"
            kind = "acp"
            command = "/bin/true"
            "#,
        );
        let profile_root = tempfile::tempdir().unwrap();
        // Include `allowed_agent_kinds: [acp]` so the C3 strict
        // `enforce_agent_kind` gate passes and the test reaches the
        // `VacSessionUnknown` branch under exam.
        std::fs::write(
            profile_root.path().join("assessor.yaml"),
            "id: assessor\nclass: assessor\nversion: 0.0.0\nallowed_agent_kinds:\n  - acp\n",
        )
        .unwrap();
        let registry =
            SessionRegistry::with_runtime_and_profiles(agents, profile_root.path().to_path_buf());
        let project_tmp = tempfile::tempdir().unwrap();
        let meta = meta_with(
            "alpha",
            "acp",
            project_tmp.path().to_path_buf(),
            "assessor",
            None, // <-- the field under test
        );
        let outcome = registry.resume_native(&meta, "acp_load").await;
        match outcome {
            ResumeNativeOutcome::Validation(f) => {
                assert_eq!(f, ResumeValidationFailure::VacSessionUnknown);
                assert_eq!(f.reason(), "vac_session_unknown");
            }
            _ => panic!("expected Validation(VacSessionUnknown)"),
        }
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
