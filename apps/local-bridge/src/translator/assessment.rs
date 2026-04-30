use crate::agent_runtime::acp::{sha256_hex_canonical, ContentBlock, PromptRequest};
use crate::agent_runtime::{is_command_installed, AgentDefinition, AgentKind};
use crate::notify::{activity_event, Severity as NotifySeverity};
use crate::server::AppStateHandle;
use crate::session::assessment_validation::{
    validate_candidate, AssessmentValidationTracker, CandidateRejection,
};
use crate::session::persistence::RedactionMode;
use crate::session::{SessionHandle, SessionHandleRef, SpawnOptions};
use crate::translator::emit_session_event;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use dashmap::DashMap;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex, OnceLock,
};
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::Notify;
use tokio::time::Instant;
use tracing::warn;
use ulid::Ulid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DepthBudget {
    Quick,
    Standard,
    Full,
}

impl DepthBudget {
    fn from_raw(raw: Option<&str>) -> Self {
        match raw.unwrap_or("standard") {
            "quick" => Self::Quick,
            "full" => Self::Full,
            _ => Self::Standard,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Quick => "quick",
            Self::Standard => "standard",
            Self::Full => "full",
        }
    }

    fn max_passes(self) -> usize {
        match self {
            Self::Quick => 1,
            Self::Standard => 2,
            Self::Full => 3,
        }
    }

    fn pass_timeout(self) -> Duration {
        match self {
            Self::Quick => Duration::from_secs(90),
            Self::Standard => Duration::from_secs(180),
            Self::Full => Duration::from_secs(300),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CategoryBucket {
    Technical,
    Product,
    Ux,
    Release,
    Ops,
}

impl CategoryBucket {
    fn from_str(raw: &str) -> Self {
        match raw {
            "product" => Self::Product,
            "ux" => Self::Ux,
            "release" => Self::Release,
            "ops" => Self::Ops,
            _ => Self::Technical,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Technical => 0,
            Self::Product => 1,
            Self::Ux => 2,
            Self::Release => 3,
            Self::Ops => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SeverityBucket {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

impl SeverityBucket {
    fn from_str(raw: &str) -> Self {
        match raw {
            "info" => Self::Info,
            "low" => Self::Low,
            "high" => Self::High,
            "critical" => Self::Critical,
            _ => Self::Medium,
        }
    }

    fn weight(self) -> f64 {
        match self {
            Self::Info => 0.02,
            Self::Low => 0.05,
            Self::Medium => 0.10,
            Self::High => 0.20,
            Self::Critical => 0.35,
        }
    }
}

#[derive(Debug, Clone)]
struct FindingMeta {
    title: String,
    category: CategoryBucket,
    severity: SeverityBucket,
}

#[derive(Debug, Default)]
struct RunStats {
    received: usize,
    accepted: usize,
    rejected: usize,
    findings: Vec<FindingMeta>,
    scores: [f64; 5],
}

impl RunStats {
    fn record_finding(
        &mut self,
        title: String,
        category: CategoryBucket,
        severity: SeverityBucket,
    ) {
        self.accepted += 1;
        self.findings.push(FindingMeta {
            title,
            category,
            severity,
        });
        let idx = category.index();
        self.scores[idx] = (self.scores[idx] - severity.weight()).max(0.0);
    }

    fn record_rejection(&mut self) {
        self.rejected += 1;
    }

    fn finding_count(&self) -> usize {
        self.findings.len()
    }

    fn severity_counts(&self) -> (usize, usize, usize, usize, usize) {
        let mut info = 0;
        let mut low = 0;
        let mut medium = 0;
        let mut high = 0;
        let mut critical = 0;
        for finding in &self.findings {
            match finding.severity {
                SeverityBucket::Info => info += 1,
                SeverityBucket::Low => low += 1,
                SeverityBucket::Medium => medium += 1,
                SeverityBucket::High => high += 1,
                SeverityBucket::Critical => critical += 1,
            }
        }
        (info, low, medium, high, critical)
    }

    fn verdict_and_detail(&self) -> (&'static str, &'static str, Value) {
        let (info, low, medium, high, critical) = self.severity_counts();
        let has_release_or_ops_high = self.findings.iter().any(|finding| {
            matches!(finding.severity, SeverityBucket::High)
                && matches!(
                    finding.category,
                    CategoryBucket::Release | CategoryBucket::Ops
                )
        });
        let verdict = if critical > 0 || has_release_or_ops_high {
            "fail"
        } else if high > 0 || medium >= 2 {
            "warn"
        } else {
            "pass"
        };
        let delivery_state = match verdict {
            "pass" => "READY",
            "warn" => "CONDITIONAL",
            _ => "BLOCKED",
        };
        let reason = if critical > 0 {
            "critical finding detected"
        } else if has_release_or_ops_high {
            "release or ops high finding"
        } else if high > 0 || medium >= 2 {
            "non-blocking findings present"
        } else {
            "no blocking findings"
        };
        (
            verdict,
            delivery_state,
            json!({
                "status": verdict.to_ascii_uppercase(),
                "delivery_state": delivery_state,
                "reason": reason,
                "counts": {
                    "received": self.received,
                    "accepted": self.accepted,
                    "rejected": self.rejected,
                    "findings": self.findings.len(),
                    "info": info,
                    "low": low,
                    "medium": medium,
                    "high": high,
                    "critical": critical,
                },
            }),
        )
    }

    fn score_payload(&self) -> Value {
        json!({
            "technical": self.scores[0],
            "product": self.scores[1],
            "ux": self.scores[2],
            "release": self.scores[3],
            "ops": self.scores[4],
        })
    }
}

#[derive(Debug)]
struct AssessmentFailure {
    status: &'static str,
    reason: &'static str,
    detail: String,
}

impl AssessmentFailure {
    fn failed(reason: &'static str, detail: impl Into<String>) -> Self {
        Self {
            status: "failed",
            reason,
            detail: detail.into(),
        }
    }

    fn cancelled(reason: &'static str, detail: impl Into<String>) -> Self {
        Self {
            status: "cancelled",
            reason,
            detail: detail.into(),
        }
    }
}

#[derive(Debug)]
struct RunControl {
    cancelled: AtomicBool,
    notify: Notify,
}

impl RunControl {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

static ACTIVE_RUNS: OnceLock<DashMap<String, Arc<RunControl>>> = OnceLock::new();
static ACTIVE_SWEEPS: OnceLock<DashMap<String, Arc<SweepControl>>> = OnceLock::new();

fn active_runs() -> &'static DashMap<String, Arc<RunControl>> {
    ACTIVE_RUNS.get_or_init(DashMap::new)
}

fn active_sweeps() -> &'static DashMap<String, Arc<SweepControl>> {
    ACTIVE_SWEEPS.get_or_init(DashMap::new)
}

#[derive(Debug)]
struct SweepControl {
    cancelled: AtomicBool,
    notify: Notify,
    current_child: StdMutex<Option<(String, Arc<RunControl>)>>,
}

impl SweepControl {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
            current_child: StdMutex::new(None),
        })
    }

    fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn set_current_child(&self, run_id: String, control: Arc<RunControl>) {
        if let Ok(mut guard) = self.current_child.lock() {
            *guard = Some((run_id, control));
        }
    }

    fn clear_current_child(&self, run_id: &str) {
        if let Ok(mut guard) = self.current_child.lock() {
            if guard
                .as_ref()
                .map(|(current_run_id, _)| current_run_id == run_id)
                .unwrap_or(false)
            {
                *guard = None;
            }
        }
    }

    fn current_child_control(&self) -> Option<Arc<RunControl>> {
        self.current_child
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|(_, control)| Arc::clone(control)))
    }
}

#[derive(Debug, Default)]
struct SweepStats {
    completed_runs: usize,
    failed_runs: usize,
    cancelled_runs: usize,
    pass_runs: usize,
    warn_runs: usize,
    fail_runs: usize,
    received: usize,
    accepted: usize,
    rejected: usize,
    findings: usize,
}

impl SweepStats {
    fn record_completed_child(&mut self, stats: &RunStats, verdict: &str) {
        self.completed_runs += 1;
        self.received += stats.received;
        self.accepted += stats.accepted;
        self.rejected += stats.rejected;
        self.findings += stats.finding_count();
        match verdict {
            "pass" => self.pass_runs += 1,
            "warn" => self.warn_runs += 1,
            _ => self.fail_runs += 1,
        }
    }

    fn record_failed_child(&mut self, stats: &RunStats, failure: &AssessmentFailure) {
        self.failed_runs += 1;
        self.received += stats.received;
        self.accepted += stats.accepted;
        self.rejected += stats.rejected;
        self.findings += stats.finding_count();
        if failure.status == "cancelled" {
            self.cancelled_runs += 1;
        } else {
            self.fail_runs += 1;
        }
    }

    fn verdict(&self) -> &'static str {
        if self.fail_runs > 0 || self.failed_runs > 0 || self.cancelled_runs > 0 {
            "fail"
        } else if self.warn_runs > 0 {
            "warn"
        } else {
            "pass"
        }
    }

    fn delivery_state(&self) -> &'static str {
        match self.verdict() {
            "pass" => "READY",
            "warn" => "CONDITIONAL",
            _ => "BLOCKED",
        }
    }

    fn counts_payload(&self, total_runs: usize) -> Value {
        json!({
            "total_runs": total_runs,
            "completed_runs": self.completed_runs,
            "failed_runs": self.failed_runs,
            "cancelled_runs": self.cancelled_runs,
            "pass_runs": self.pass_runs,
            "warn_runs": self.warn_runs,
            "fail_runs": self.fail_runs,
            "received": self.received,
            "accepted": self.accepted,
            "rejected": self.rejected,
            "findings": self.findings,
        })
    }
}

fn family_profile_id(swarm: &str) -> &'static str {
    match swarm {
        "pm" => "assessor.pm@1.0.0",
        "ux" => "assessor.ux@1.0.0",
        "frontend" => "assessor.frontend@1.0.0",
        "security" => "assessor.security@1.0.0",
        "reliability" => "assessor.reliability@1.0.0",
        "performance" => "assessor.perf@1.0.0",
        "qa" => "assessor.qa@1.0.0",
        "docs" => "assessor.docs@1.0.0",
        "launch" => "assessor.launch@1.0.0",
        "release" => "assessor.release@1.0.0",
        "growth" => "assessor.growth@1.0.0",
        _ => "assessor.rtd@1.0.0",
    }
}

const SWEEP_FAMILIES: &[&str] = &[
    "rtd",
    "pm",
    "ux",
    "frontend",
    "security",
    "reliability",
    "performance",
    "qa",
    "docs",
    "launch",
    "release",
    "growth",
];

fn family_catalog(family: &str) -> Vec<(&'static str, &'static str, &'static str)> {
    match family {
        "pm" => vec![
            ("discovery", "product", "user_interviews"),
            ("pricing", "product", "pricing_alignment"),
            ("positioning", "product", "market_fit"),
            ("competition", "product", "landscape_scan"),
            ("metrics", "product", "north_star"),
            ("go_to_market", "release", "launch_plan"),
            ("synthesizer", "product", "verdict"),
        ],
        "ux" => vec![
            ("flows", "ux", "task_completion"),
            ("a11y", "ux", "wcag_aa"),
            ("copy", "ux", "voice_tone"),
            ("visual", "ux", "contrast"),
            ("synthesizer", "ux", "verdict"),
        ],
        "frontend" => vec![
            ("bundle_size", "technical", "budget"),
            ("a11y_axe", "ux", "axe_violations"),
            ("perf_lh", "technical", "lighthouse_score"),
            ("hydration", "technical", "island_cost"),
            ("synthesizer", "technical", "verdict"),
        ],
        "security" => vec![
            ("deps", "technical", "vuln_scan"),
            ("secrets", "technical", "leaked_secrets"),
            ("authz", "technical", "authorization_matrix"),
            ("sbom", "ops", "supply_chain"),
            ("synthesizer", "technical", "verdict"),
        ],
        "reliability" => vec![
            ("slo", "ops", "slo_burn"),
            ("chaos", "ops", "fault_injection"),
            ("backup", "ops", "backup_restore"),
            ("runbooks", "ops", "coverage"),
            ("synthesizer", "ops", "verdict"),
        ],
        "performance" => vec![
            ("bench_api", "technical", "p95_latency"),
            ("bench_render", "technical", "tti"),
            ("memory", "technical", "growth"),
            ("synthesizer", "technical", "verdict"),
        ],
        "qa" => vec![
            ("unit", "technical", "coverage"),
            ("integration", "technical", "smoke"),
            ("e2e", "technical", "critical_paths"),
            ("regression", "technical", "baseline_diff"),
            ("synthesizer", "technical", "verdict"),
        ],
        "docs" => vec![
            ("readme", "release", "freshness"),
            ("api_docs", "release", "coverage"),
            ("changelog", "release", "up_to_date"),
            ("synthesizer", "release", "verdict"),
        ],
        "launch" => vec![
            ("announce", "release", "copy_ready"),
            ("rollout", "release", "stage_plan"),
            ("support", "ops", "handover"),
            ("synthesizer", "release", "verdict"),
        ],
        "release" => vec![
            ("gate_check", "release", "gate_matrix"),
            ("rollback", "release", "plan_exists"),
            ("compliance", "release", "legal_ok"),
            ("synthesizer", "release", "verdict"),
        ],
        "growth" => vec![
            ("funnel", "product", "activation"),
            ("retention", "product", "d7_d30"),
            ("virality", "product", "k_factor"),
            ("synthesizer", "product", "verdict"),
        ],
        _ => vec![
            ("code_health", "technical", "coverage_drift"),
            ("test_coverage", "technical", "branch_coverage"),
            ("security", "technical", "dep_audit"),
            ("observability", "ops", "trace_hygiene"),
            ("release_gate", "release", "verdict"),
        ],
    }
}

fn build_started_event(
    controller: &SessionHandleRef,
    run_id: &str,
    swarm: &str,
    depth: DepthBudget,
    worker: &SessionHandleRef,
    started_at: &str,
    max_passes: usize,
    sweep_id: Option<&str>,
) -> ServerEvent {
    let mut payload = json!({
        "run_id": run_id,
        "swarm": swarm,
        "total_checks": max_passes,
        "started_at": started_at,
        "scope": {
            "project_root": controller.project_root,
            "depth": depth.as_str(),
        },
        "agent_id": worker.agent_id,
        "agent_kind": worker.agent_kind.as_str(),
        "agent_role": "assessment-worker",
        "worker_session_id": worker.id,
    });
    if let Some(sweep_id) = sweep_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sweep_id".into(), json!(sweep_id));
        }
    }
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.started".into(),
        payload,
        v: 1,
        ts: started_at.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_progress_event(
    controller: &SessionHandleRef,
    run_id: &str,
    worker: &SessionHandleRef,
    completed: usize,
    total: usize,
    current: &str,
    phase: &str,
    pass_index: usize,
    max_passes: usize,
    reason: &str,
    elapsed_ms: u64,
    sweep_id: Option<&str>,
) -> ServerEvent {
    let ts = chrono::Utc::now().to_rfc3339();
    let mut payload = json!({
        "run_id": run_id,
        "completed": completed,
        "total": total,
        "current": current,
        "phase": phase,
        "pass": pass_index,
        "max_passes": max_passes,
        "reason": reason,
        "elapsed_ms": elapsed_ms,
        "agent_id": worker.agent_id,
        "agent_kind": worker.agent_kind.as_str(),
        "agent_role": "assessment-worker",
        "worker_session_id": worker.id,
    });
    if let Some(sweep_id) = sweep_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sweep_id".into(), json!(sweep_id));
        }
    }
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.progress".into(),
        payload,
        v: 1,
        ts,
    }
}

fn build_completed_event(
    controller: &SessionHandleRef,
    run_id: &str,
    worker: &SessionHandleRef,
    stats: &RunStats,
    passes_completed: usize,
    started_at: Instant,
    sweep_id: Option<&str>,
) -> ServerEvent {
    let (verdict, delivery_state, verdict_detail) = stats.verdict_and_detail();
    let ts = chrono::Utc::now().to_rfc3339();
    let mut payload = json!({
        "run_id": run_id,
        "verdict": verdict,
        "score": stats.score_payload(),
        "counts": {
            "received": stats.received,
            "accepted": stats.accepted,
            "rejected": stats.rejected,
            "findings": stats.finding_count(),
        },
        "agent_id": worker.agent_id,
        "agent_kind": worker.agent_kind.as_str(),
        "agent_role": "assessment-worker",
        "worker_session_id": worker.id,
        "passes_completed": passes_completed,
        "elapsed_ms": started_at.elapsed().as_millis() as u64,
        "verdict_detail": verdict_detail,
        "delivery_state": delivery_state,
    });
    if let Some(sweep_id) = sweep_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sweep_id".into(), json!(sweep_id));
        }
    }
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.completed".into(),
        payload,
        v: 1,
        ts,
    }
}

fn build_failed_event(
    controller: &SessionHandleRef,
    run_id: &str,
    worker: &SessionHandleRef,
    stats: &RunStats,
    failure: &AssessmentFailure,
    passes_completed: usize,
    started_at: Instant,
    sweep_id: Option<&str>,
) -> ServerEvent {
    let ts = chrono::Utc::now().to_rfc3339();
    let mut payload = json!({
        "run_id": run_id,
        "status": failure.status,
        "reason": failure.reason,
        "detail": failure.detail,
        "counts": {
            "received": stats.received,
            "accepted": stats.accepted,
            "rejected": stats.rejected,
            "findings": stats.finding_count(),
        },
        "agent_id": worker.agent_id,
        "agent_kind": worker.agent_kind.as_str(),
        "agent_role": "assessment-worker",
        "worker_session_id": worker.id,
        "passes_completed": passes_completed,
        "elapsed_ms": started_at.elapsed().as_millis() as u64,
    });
    if let Some(sweep_id) = sweep_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sweep_id".into(), json!(sweep_id));
        }
    }
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.failed".into(),
        payload,
        v: 1,
        ts,
    }
}

fn build_sweep_started_event(
    controller: &SessionHandleRef,
    sweep_id: &str,
    families: &[String],
    started_at: &str,
    total_runs: usize,
    agent: &AgentDefinition,
) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.sweep.started".into(),
        payload: json!({
            "sweep_id": sweep_id,
            "families": families,
            "status": "running",
            "started_at": started_at,
            "total_runs": total_runs,
            "scope": {
                "project_root": controller.project_root,
            },
            "agent_id": agent.id.clone(),
            "agent_kind": agent.kind.as_str(),
            "agent_role": "assessment-sweep",
        }),
        v: 1,
        ts: started_at.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_sweep_progress_event(
    controller: &SessionHandleRef,
    sweep_id: &str,
    total_runs: usize,
    completed: usize,
    current: &str,
    phase: &str,
    reason: &str,
    elapsed_ms: u64,
    stats: &SweepStats,
    current_verdict: &str,
) -> ServerEvent {
    let ts = chrono::Utc::now().to_rfc3339();
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: "assessment.sweep.progress".into(),
        payload: json!({
            "sweep_id": sweep_id,
            "status": "running",
            "completed": completed,
            "total": total_runs,
            "current": current,
            "phase": phase,
            "reason": reason,
            "elapsed_ms": elapsed_ms,
            "verdict": current_verdict,
            "counts": stats.counts_payload(total_runs),
        }),
        v: 1,
        ts,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_sweep_terminal_event(
    controller: &SessionHandleRef,
    sweep_id: &str,
    event_type: &'static str,
    status: &str,
    started_at: &str,
    completed_runs: usize,
    stats: &SweepStats,
    total_runs: usize,
    reason: &str,
    detail: Option<String>,
    agent: &AgentDefinition,
) -> ServerEvent {
    let verdict = stats.verdict();
    let delivery_state = stats.delivery_state();
    let verdict_detail = json!({
        "status": verdict.to_ascii_uppercase(),
        "delivery_state": delivery_state,
        "reason": reason,
        "counts": stats.counts_payload(total_runs),
    });
    let ts = chrono::Utc::now().to_rfc3339();
    let mut payload = json!({
        "sweep_id": sweep_id,
        "status": status,
        "completed": completed_runs,
        "total": total_runs,
        "verdict": verdict,
        "verdict_detail": verdict_detail,
        "counts": stats.counts_payload(total_runs),
        "started_at": started_at,
        "finished_at": ts,
        "agent_id": agent.id.clone(),
        "agent_kind": agent.kind.as_str(),
        "agent_role": "assessment-sweep",
    });
    if let Some(detail) = detail {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("detail".into(), json!(detail));
        }
    }
    ServerEvent {
        seq: 0,
        session_id: controller.id.clone(),
        event_type: event_type.to_string(),
        payload,
        v: 1,
        ts,
    }
}

fn build_worker_spawn_options(
    state: &AppStateHandle,
    worker_session_id: String,
    profile_id: String,
    project_root: PathBuf,
    agent: AgentDefinition,
) -> SpawnOptions {
    SpawnOptions {
        session_id: worker_session_id,
        profile_id,
        project_root,
        agent,
        audit: None,
        workflow_id: None,
        profile_root: state.profile_root.clone(),
        persistence: None,
        persistence_health: state.persistence_health.clone(),
        redaction_mode: RedactionMode::Standard,
        resume_native: None,
        // Phase N1 — worker spawns intentionally bypass the SQLite
        // double-write path. Worker sessions don't carry persistence
        // (see `persistence: None` above) so there's no JSONL append
        // for the index to mirror; the parent assessment session is
        // the one whose sink owns the cache index.
        assessment_index: None,
    }
}

fn choose_worker_agent(
    registry: &Arc<crate::agent_runtime::AgentRuntimeRegistry>,
    requested_agent_id: Option<&str>,
) -> anyhow::Result<AgentDefinition> {
    if let Some(id) = requested_agent_id {
        let agent = registry.get(id)?.clone();
        if !agent.enabled {
            anyhow::bail!("agent.disabled: agent `{id}` is disabled");
        }
        return Ok(agent);
    }

    if let Some(agent) = registry
        .list_enabled()
        .into_iter()
        .find(|agent| agent.kind == AgentKind::Acp && is_command_installed(&agent.command))
    {
        return Ok((*agent).clone());
    }

    Ok(registry.default_agent().clone())
}

#[derive(Debug)]
enum AssessmentStartError {
    WorkerSpawnFailed(String),
}

struct StartedAssessmentRun {
    run_id: String,
    worker: SessionHandleRef,
    control: Arc<RunControl>,
}

async fn start_assessment_run(
    state: &AppStateHandle,
    controller: &SessionHandleRef,
    swarm: &str,
    selected_agent: &AgentDefinition,
) -> Result<StartedAssessmentRun, AssessmentStartError> {
    let worker_session_id = format!("assess_{}", Ulid::new());
    let worker: SessionHandleRef = SessionHandle::spawn(build_worker_spawn_options(
        state,
        worker_session_id,
        family_profile_id(swarm).to_string(),
        controller.project_root.clone(),
        selected_agent.clone(),
    ))
    .await
    .map_err(|e| AssessmentStartError::WorkerSpawnFailed(e.to_string()))?;

    let run_id = format!("run_{}", Ulid::new());
    let control = RunControl::new();
    active_runs().insert(run_id.clone(), Arc::clone(&control));

    Ok(StartedAssessmentRun {
        run_id,
        worker,
        control,
    })
}

fn augment_payload(payload: Value, fields: &[(&str, Value)]) -> Value {
    let mut payload = payload;
    let Some(obj) = payload.as_object_mut() else {
        return payload;
    };
    for (key, value) in fields {
        obj.insert((*key).to_string(), value.clone());
    }
    payload
}

async fn emit_controller_event(controller: &SessionHandleRef, event_type: &str, payload: Value) {
    emit_session_event(
        controller,
        ServerEvent {
            seq: 0,
            session_id: controller.id.clone(),
            event_type: event_type.to_string(),
            payload,
            v: 1,
            ts: chrono::Utc::now().to_rfc3339(),
        },
    )
    .await;
}

fn candidate_payloads_from_worker_event(payload: &Value) -> Vec<Value> {
    if let Some(arr) = payload.get("candidates").and_then(Value::as_array) {
        return arr.clone();
    }
    if let Some(candidate) = payload.get("candidate") {
        return vec![candidate.clone()];
    }
    if payload
        .as_object()
        .map(|obj| {
            obj.contains_key("title")
                || obj.contains_key("identityHash")
                || obj.contains_key("identity_hash")
        })
        .unwrap_or(false)
    {
        return vec![payload.clone()];
    }
    Vec::new()
}

fn extract_json_slice(text: &str) -> Option<&str> {
    let start = text.find('{').or_else(|| text.find('['))?;
    let end = text.rfind('}').or_else(|| text.rfind(']'))?;
    if end >= start {
        Some(&text[start..=end])
    } else {
        None
    }
}

/// Maximum length of the `sample` field on `assessment.worker_output_rejected`
/// events. Keep this small enough to fit comfortably in a UI banner and
/// short enough that operators are nudged toward the Replay action for the
/// full transcript instead of trusting the truncated copy.
const WORKER_OUTPUT_SAMPLE_LIMIT: usize = 500;

/// Redact obvious secrets out of a worker-output sample, then truncate to
/// `WORKER_OUTPUT_SAMPLE_LIMIT` chars. Mirrors the token shapes used by
/// `session::persistence::redact` so a sample published in the live event
/// stream cannot leak credentials that the persistence redactor would
/// have stripped from the JSONL log.
fn redact_worker_sample(transcript: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;

    static TOKEN_RE: OnceLock<Regex> = OnceLock::new();
    let token_re = TOKEN_RE.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer\s+|sk-|ghp_|xoxb-|xoxa-|xoxp-|aws[a-z0-9]*=)[A-Za-z0-9\-_=]{8,}")
            .expect("worker sample redaction regex must compile")
    });

    let scrubbed = token_re.replace_all(transcript, "[REDACTED]");
    let truncated: String = scrubbed.chars().take(WORKER_OUTPUT_SAMPLE_LIMIT).collect();
    truncated
}

/// Emit `assessment.worker_output_rejected` on the controller session.
/// Carries the full provenance triplet (worker_session_id, agent_id,
/// agent_kind) so downstream consumers can correlate the rejection with
/// the worker that produced it. The caller is expected to follow this
/// with a terminal failure so the run also surfaces an
/// `assessment.failed { reason: "invalid_worker_output" }`.
#[allow(clippy::too_many_arguments)]
async fn emit_worker_output_rejected(
    controller: &SessionHandleRef,
    run_id: &str,
    worker: &SessionHandleRef,
    pass: usize,
    max_passes: usize,
    code: &str,
    detail: &str,
    path: Option<&str>,
    transcript: &str,
) {
    let sample = redact_worker_sample(transcript);
    emit_controller_event(
        controller,
        "assessment.worker_output_rejected",
        json!({
            "run_id": run_id,
            "worker_session_id": worker.id,
            "agent_id": worker.agent_id,
            "agent_kind": worker.agent_kind.as_str(),
            "agent_role": "assessment-worker",
            "reason": "schema_invalid",
            "code": code,
            "detail": detail,
            "path": path,
            "pass": pass,
            "max_passes": max_passes,
            "sample": sample,
        }),
    )
    .await;
}

/// Like [`parse_acp_candidate_payload`] but also surfaces a structured
/// envelope rejection when the worker emitted a recognisable v1 envelope
/// that failed validation. The legacy heuristic is still consulted as a
/// fallback so plain JSON-array workers keep flowing.
fn parse_acp_candidate_payload_full(
    text: &str,
) -> Result<
    (
        Vec<Value>,
        Option<crate::translator::assessment_schema::WorkerOutputRejection>,
    ),
    String,
> {
    use crate::translator::assessment_schema::{validate_worker_output, EnvelopeOutcome};

    let trimmed = text.trim();
    let candidates = [trimmed, extract_json_slice(trimmed).unwrap_or(trimmed)];
    for candidate in candidates {
        if candidate.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(candidate) {
            return match validate_worker_output(&value) {
                EnvelopeOutcome::Recognised(Ok(env)) => Ok((env.candidates, None)),
                EnvelopeOutcome::Recognised(Err(rej)) => {
                    // Fall back to the heuristic so we don't drop
                    // already-valid findings just because the envelope
                    // metadata was wrong, but bubble the rejection up so
                    // the caller can emit assessment.worker_output_rejected.
                    Ok((candidate_payloads_from_worker_event(&value), Some(rej)))
                }
                EnvelopeOutcome::NotEnvelope => {
                    Ok((candidate_payloads_from_worker_event(&value), None))
                }
            };
        }
    }
    Err("worker output did not contain parseable JSON".to_string())
}

async fn process_candidate(
    controller: &SessionHandleRef,
    worker: &SessionHandleRef,
    run_id: &str,
    source_event_type: &str,
    candidate: &Value,
    stats: &mut RunStats,
    tracker: &mut AssessmentValidationTracker,
) -> Result<Option<FindingMeta>, CandidateRejection> {
    let candidate_hash = format!("sha256:{}", sha256_hex_canonical(candidate));
    stats.received += 1;

    emit_controller_event(
        controller,
        "assessment.candidate_received",
        json!({
            "run_id": run_id,
            "candidate_hash": candidate_hash,
            "candidate_count": 1,
            "source_event_type": source_event_type,
            "agent_id": worker.agent_id,
            "agent_kind": worker.agent_kind.as_str(),
            "agent_role": "assessment-worker",
            "worker_session_id": worker.id,
            "candidate": candidate,
        }),
    )
    .await;

    match validate_candidate(
        &controller.project_root,
        tracker,
        run_id,
        candidate,
        source_event_type,
    ) {
        Ok(validation) => {
            let finding_id = validation
                .finding_event
                .get("finding_id")
                .and_then(Value::as_str)
                .unwrap_or("fnd_unknown")
                .to_string();
            let finding_title = validation
                .finding_event
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("candidate")
                .to_string();
            let category = validation
                .finding_event
                .get("category")
                .and_then(Value::as_str)
                .map(CategoryBucket::from_str)
                .unwrap_or(CategoryBucket::Technical);
            let severity = validation
                .finding_event
                .get("severity")
                .and_then(Value::as_str)
                .map(SeverityBucket::from_str)
                .unwrap_or(SeverityBucket::Medium);

            for evidence in validation.evidence_events {
                emit_controller_event(
                    controller,
                    "assessment.evidence_attached",
                    augment_payload(
                        evidence,
                        &[
                            ("run_id", json!(run_id)),
                            ("candidate_hash", json!(candidate_hash)),
                            ("source_event_type", json!(source_event_type)),
                            ("agent_id", json!(worker.agent_id)),
                            ("agent_kind", json!(worker.agent_kind.as_str())),
                            ("agent_role", json!("assessment-worker")),
                            ("worker_session_id", json!(worker.id)),
                            ("finding_id", json!(finding_id)),
                        ],
                    ),
                )
                .await;
            }

            emit_controller_event(
                controller,
                "assessment.finding_added",
                augment_payload(
                    validation.finding_event,
                    &[
                        ("run_id", json!(run_id)),
                        ("candidate_hash", json!(candidate_hash)),
                        ("source_event_type", json!(source_event_type)),
                        ("agent_id", json!(worker.agent_id)),
                        ("agent_kind", json!(worker.agent_kind.as_str())),
                        ("agent_role", json!("assessment-worker")),
                        ("worker_session_id", json!(worker.id)),
                    ],
                ),
            )
            .await;

            if let Some(audit) = controller.audit.as_ref() {
                audit.log(
                    &controller.id,
                    "assessment",
                    bridge_core::AuditSeverity::Info,
                    json!({
                        "event": "finding_added",
                        "run_id": run_id,
                        "candidate_hash": candidate_hash,
                        "finding_id": finding_id,
                        "agent_id": worker.agent_id,
                        "agent_kind": worker.agent_kind.as_str(),
                        "source_event_type": source_event_type,
                    }),
                );
            }

            let summary = format!("Validated finding: {finding_title}");
            emit_controller_event(
                controller,
                "activity.appended",
                activity_event(
                    controller.id.clone(),
                    "assessment",
                    NotifySeverity::Info,
                    &summary,
                )
                .payload,
            )
            .await;

            stats.record_finding(finding_title.clone(), category, severity);
            Ok(Some(FindingMeta {
                title: finding_title,
                category,
                severity,
            }))
        }
        Err(rejection) => {
            emit_controller_event(
                controller,
                "assessment.candidate_rejected",
                json!({
                    "run_id": run_id,
                    "candidate_hash": candidate_hash,
                    "reason": rejection.reason,
                    "summary": rejection.summary,
                    "source_event_type": source_event_type,
                    "agent_id": worker.agent_id,
                    "agent_kind": worker.agent_kind.as_str(),
                    "agent_role": "assessment-worker",
                    "worker_session_id": worker.id,
                }),
            )
            .await;

            if let Some(audit) = controller.audit.as_ref() {
                audit.log(
                    &controller.id,
                    "assessment",
                    bridge_core::AuditSeverity::Warn,
                    json!({
                        "event": "candidate_rejected",
                        "run_id": run_id,
                        "candidate_hash": candidate_hash,
                        "reason": rejection.reason,
                        "summary": rejection.summary,
                        "agent_id": worker.agent_id,
                        "agent_kind": worker.agent_kind.as_str(),
                        "source_event_type": source_event_type,
                    }),
                );
            }

            let summary = format!("Rejected candidate: {}", rejection.summary);
            emit_controller_event(
                controller,
                "activity.appended",
                activity_event(
                    controller.id.clone(),
                    "assessment",
                    NotifySeverity::Warn,
                    &summary,
                )
                .payload,
            )
            .await;

            stats.record_rejection();
            Err(rejection)
        }
    }
}

fn build_acp_prompt(
    swarm: &str,
    pass_index: usize,
    max_passes: usize,
    project_root: &Path,
    worker: &SessionHandleRef,
    known_findings: &[String],
) -> String {
    let checks = family_catalog(swarm);
    let checklist = checks
        .iter()
        .map(|(agent, category, check)| format!("- {agent} | {category} | {check}"))
        .collect::<Vec<_>>()
        .join("\n");
    let known = if known_findings.is_empty() {
        "none".to_string()
    } else {
        known_findings
            .iter()
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"You are a read-only assessment worker for VAC.

Worker agent: {worker_id} ({worker_kind})
Family: {swarm}
Pass: {pass_index}/{max_passes}
Project root: {project_root}

Focus on these checks:
{checklist}

Known validated findings to avoid duplicating:
{known}

Return ONLY valid JSON, no prose and no code fences.
Shape:
{{"candidates":[{{"title":"...","category":"technical|product|ux|release|ops","severity":"info|low|medium|high|critical","confidence":0.0,"description":"...","rationale":"...","recommendation":"...","fixability":"manual|assisted","evidence":[{{"kind":"file","path":"relative/path","line":123}}],"tags":["..."],"emittedBy":"{worker_id}"}}]}}

If you find nothing, return {{"candidates":[]}}.
"#,
        worker_id = worker.agent_id,
        worker_kind = worker.agent_kind.as_str(),
        swarm = swarm,
        pass_index = pass_index,
        max_passes = max_passes,
        project_root = project_root.display(),
        checklist = checklist,
        known = known,
    )
}

pub async fn dispatch_assessment_run(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(controller) = state.sessions.get(&cmd.session_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: format!("session {} not found", cmd.session_id),
                }),
            },
            vec![],
        );
    };

    let swarm = cmd
        .payload
        .get("swarm")
        .and_then(|v| v.as_str())
        .unwrap_or("rtd")
        .to_string();
    let depth = DepthBudget::from_raw(cmd.payload.get("depth").and_then(|v| v.as_str()));
    let requested_agent_id = cmd
        .payload
        .get("agent_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let agent_role = cmd
        .payload
        .get("agent_role")
        .and_then(|v| v.as_str())
        .unwrap_or("assessment-worker");
    let registry = state.sessions.agents();
    let selected_agent = match choose_worker_agent(&registry, requested_agent_id.as_deref()) {
        Ok(agent) => agent,
        Err(e) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "agent.not_registered".into(),
                        message: e.to_string(),
                    }),
                },
                vec![],
            )
        }
    };

    let started = match start_assessment_run(state, &controller, &swarm, &selected_agent).await {
        Ok(started) => started,
        Err(AssessmentStartError::WorkerSpawnFailed(error)) => {
            warn!(error = %error, "assessment worker spawn failed");
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "assessment.worker_spawn_failed".into(),
                        message: error,
                    }),
                },
                vec![],
            );
        }
    };

    let controller_for_task = Arc::clone(&controller);
    let worker_for_task = Arc::clone(&started.worker);
    let state_for_task = Arc::clone(state);
    let swarm_for_task = swarm.clone();
    let depth_for_task = depth;
    let run_id_for_task = started.run_id.clone();
    let agent_role_for_task = agent_role.to_string();
    let control = Arc::clone(&started.control);

    tokio::spawn(async move {
        let started_at = Instant::now();
        let mut stats = RunStats::default();
        let result = run_assessment_task(
            &controller_for_task,
            &state_for_task,
            &worker_for_task,
            &swarm_for_task,
            depth_for_task,
            &run_id_for_task,
            &agent_role_for_task,
            None,
            &control,
            started_at,
            &mut stats,
        )
        .await;

        match result {
            Ok(passes_completed) => {
                let event = build_completed_event(
                    &controller_for_task,
                    &run_id_for_task,
                    &worker_for_task,
                    &stats,
                    passes_completed,
                    started_at,
                    None,
                );
                emit_session_event(&controller_for_task, event).await;
            }
            Err(failure) => {
                let event = build_failed_event(
                    &controller_for_task,
                    &run_id_for_task,
                    &worker_for_task,
                    &stats,
                    &failure,
                    stats.finding_count(),
                    started_at,
                    None,
                );
                emit_session_event(&controller_for_task, event).await;
            }
        }

        let _ = worker_for_task.close_stdin().await;
        active_runs().remove(&run_id_for_task);
    });

    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![],
    )
}

pub async fn dispatch_assessment_cancel(
    cmd: &ClientCommand,
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(run_id) = cmd.payload.get("run_id").and_then(|v| v.as_str()) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "assessment.invalid_payload".into(),
                    message: "assessment.cancel requires run_id".into(),
                }),
            },
            vec![],
        );
    };
    if let Some(control) = active_runs().get(run_id) {
        control.request_cancel();
        (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: true,
                error: None,
            },
            vec![],
        )
    } else {
        (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "assessment.not_found".into(),
                    message: format!("assessment run {run_id} not active"),
                }),
            },
            vec![],
        )
    }
}

fn parse_sweep_families(payload: &Value) -> Vec<String> {
    if let Some(arr) = payload.get("families").and_then(Value::as_array) {
        let mut families = Vec::new();
        for item in arr {
            if let Some(family) = item.as_str() {
                let family = family.trim();
                if !family.is_empty() && !families.iter().any(|cur| cur == family) {
                    families.push(family.to_string());
                }
            }
        }
        if !families.is_empty() {
            return families;
        }
    }

    if let Some(swarm) = payload.get("swarm").and_then(Value::as_str) {
        let swarm = swarm.trim();
        if swarm.eq_ignore_ascii_case("all") || swarm.eq_ignore_ascii_case("all families") {
            return SWEEP_FAMILIES
                .iter()
                .map(|family| (*family).to_string())
                .collect();
        }
        if !swarm.is_empty() {
            return vec![swarm.to_string()];
        }
    }

    SWEEP_FAMILIES
        .iter()
        .map(|family| (*family).to_string())
        .collect()
}

pub async fn dispatch_assessment_sweep_run(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(controller) = state.sessions.get(&cmd.session_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "session.not_found".into(),
                    message: format!("session {} not found", cmd.session_id),
                }),
            },
            vec![],
        );
    };

    let depth = DepthBudget::from_raw(cmd.payload.get("depth").and_then(|v| v.as_str()));
    let requested_agent_id = cmd
        .payload
        .get("agent_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let agent_role = cmd
        .payload
        .get("agent_role")
        .and_then(|v| v.as_str())
        .unwrap_or("assessment-sweep");
    let families = parse_sweep_families(&cmd.payload);
    let registry = state.sessions.agents();
    let selected_agent = match choose_worker_agent(&registry, requested_agent_id.as_deref()) {
        Ok(agent) => agent,
        Err(e) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "agent.not_registered".into(),
                        message: e.to_string(),
                    }),
                },
                vec![],
            )
        }
    };

    let sweep_id = format!("sweep_{}", Ulid::new());
    let control = SweepControl::new();
    active_sweeps().insert(sweep_id.clone(), Arc::clone(&control));

    let controller_for_task = Arc::clone(&controller);
    let state_for_task = Arc::clone(state);
    let families_for_task = families.clone();
    let selected_agent_for_task = selected_agent.clone();
    let sweep_id_for_task = sweep_id.clone();
    let agent_role_for_task = agent_role.to_string();

    tokio::spawn(async move {
        let started_at = Instant::now();
        let started_at_wall = chrono::Utc::now().to_rfc3339();
        emit_controller_event(
            &controller_for_task,
            "assessment.sweep.started",
            build_sweep_started_event(
                &controller_for_task,
                &sweep_id_for_task,
                &families_for_task,
                &started_at_wall,
                families_for_task.len(),
                &selected_agent_for_task,
            )
            .payload,
        )
        .await;

        let mut sweep_stats = SweepStats::default();
        let total_runs = families_for_task.len();
        let mut completed_runs = 0usize;
        let mut final_status = "completed";
        let mut terminal_reason = "all families complete".to_string();
        let mut terminal_detail: Option<String> = None;

        for family in families_for_task {
            if control.is_cancelled() {
                final_status = "cancelled";
                terminal_reason = "user requested cancel".to_string();
                break;
            }

            let started = match start_assessment_run(
                &state_for_task,
                &controller_for_task,
                &family,
                &selected_agent_for_task,
            )
            .await
            {
                Ok(started) => started,
                Err(AssessmentStartError::WorkerSpawnFailed(error)) => {
                    final_status = "failed";
                    terminal_reason = "worker_spawn_failed".to_string();
                    terminal_detail = Some(error);
                    break;
                }
            };

            control.set_current_child(started.run_id.clone(), Arc::clone(&started.control));
            let mut child_stats = RunStats::default();
            let child_started_at = Instant::now();
            let result = run_assessment_task(
                &controller_for_task,
                &state_for_task,
                &started.worker,
                &family,
                depth,
                &started.run_id,
                &agent_role_for_task,
                Some(&sweep_id_for_task),
                &started.control,
                child_started_at,
                &mut child_stats,
            )
            .await;

            match result {
                Ok(passes_completed) => {
                    let event = build_completed_event(
                        &controller_for_task,
                        &started.run_id,
                        &started.worker,
                        &child_stats,
                        passes_completed,
                        child_started_at,
                        Some(&sweep_id_for_task),
                    );
                    emit_session_event(&controller_for_task, event).await;
                    let (verdict, _, _) = child_stats.verdict_and_detail();
                    sweep_stats.record_completed_child(&child_stats, verdict);
                }
                Err(failure) => {
                    let event = build_failed_event(
                        &controller_for_task,
                        &started.run_id,
                        &started.worker,
                        &child_stats,
                        &failure,
                        child_stats.finding_count(),
                        child_started_at,
                        Some(&sweep_id_for_task),
                    );
                    emit_session_event(&controller_for_task, event).await;
                    sweep_stats.record_failed_child(&child_stats, &failure);
                    if failure.status == "cancelled" {
                        final_status = "cancelled";
                        terminal_reason = failure.reason.to_string();
                        terminal_detail = Some(failure.detail);
                        let _ = started.worker.close_stdin().await;
                        active_runs().remove(&started.run_id);
                        control.clear_current_child(&started.run_id);
                        completed_runs += 1;
                        emit_controller_event(
                            &controller_for_task,
                            "assessment.sweep.progress",
                            build_sweep_progress_event(
                                &controller_for_task,
                                &sweep_id_for_task,
                                total_runs,
                                completed_runs,
                                &family,
                                "family_complete",
                                "cancelled",
                                started_at.elapsed().as_millis() as u64,
                                &sweep_stats,
                                sweep_stats.verdict(),
                            )
                            .payload,
                        )
                        .await;
                        break;
                    }
                    if final_status == "completed" {
                        final_status = "failed";
                        terminal_reason = failure.reason.to_string();
                        terminal_detail = Some(failure.detail);
                    }
                }
            }

            let _ = started.worker.close_stdin().await;
            active_runs().remove(&started.run_id);
            control.clear_current_child(&started.run_id);
            completed_runs += 1;

            emit_controller_event(
                &controller_for_task,
                "assessment.sweep.progress",
                build_sweep_progress_event(
                    &controller_for_task,
                    &sweep_id_for_task,
                    total_runs,
                    completed_runs,
                    &family,
                    "family_complete",
                    if final_status == "failed" {
                        "child_failed"
                    } else {
                        "child_completed"
                    },
                    started_at.elapsed().as_millis() as u64,
                    &sweep_stats,
                    sweep_stats.verdict(),
                )
                .payload,
            )
            .await;
        }

        let terminal_event = if final_status == "completed" && completed_runs >= total_runs {
            build_sweep_terminal_event(
                &controller_for_task,
                &sweep_id_for_task,
                "assessment.sweep.completed",
                "completed",
                &started_at_wall,
                completed_runs,
                &sweep_stats,
                total_runs,
                &terminal_reason,
                terminal_detail,
                &selected_agent_for_task,
            )
        } else {
            build_sweep_terminal_event(
                &controller_for_task,
                &sweep_id_for_task,
                "assessment.sweep.failed",
                final_status,
                &started_at_wall,
                completed_runs,
                &sweep_stats,
                total_runs,
                &terminal_reason,
                terminal_detail,
                &selected_agent_for_task,
            )
        };
        emit_session_event(&controller_for_task, terminal_event).await;
        active_sweeps().remove(&sweep_id_for_task);
    });

    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![],
    )
}

pub async fn dispatch_assessment_sweep_cancel(
    cmd: &ClientCommand,
    _state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(sweep_id) = cmd.payload.get("sweep_id").and_then(|v| v.as_str()) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "assessment.invalid_payload".into(),
                    message: "assessment.sweep.cancel requires sweep_id".into(),
                }),
            },
            vec![],
        );
    };

    let Some(sweep) = active_sweeps().get(sweep_id) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "assessment.not_found".into(),
                    message: format!("assessment sweep {sweep_id} not active"),
                }),
            },
            vec![],
        );
    };

    sweep.request_cancel();
    if let Some(child) = sweep.current_child_control() {
        child.request_cancel();
    }

    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![],
    )
}

#[allow(clippy::too_many_arguments)]
async fn run_assessment_task(
    controller: &SessionHandleRef,
    _state: &AppStateHandle,
    worker: &SessionHandleRef,
    swarm: &str,
    depth: DepthBudget,
    run_id: &str,
    agent_role: &str,
    sweep_id: Option<&str>,
    control: &Arc<RunControl>,
    started_at: Instant,
    stats: &mut RunStats,
) -> Result<usize, AssessmentFailure> {
    let max_passes = depth.max_passes();
    let started = build_started_event(
        controller,
        run_id,
        swarm,
        depth,
        worker,
        &chrono::Utc::now().to_rfc3339(),
        max_passes,
        sweep_id,
    );
    emit_session_event(controller, started).await;

    let worker_kind = worker.agent_kind;
    let mut worker_rx = worker.broadcast.subscribe();
    let deadline = Instant::now() + depth.pass_timeout();

    match worker_kind {
        AgentKind::Acp => {
            let acp = worker.acp.as_ref().ok_or_else(|| {
                AssessmentFailure::failed("worker_unavailable", "ACP runtime missing")
            })?;
            let client = &acp.client;
            let acp_session_id = acp.acp_session_id.clone();
            let mut known_titles: Vec<String> = Vec::new();
            let mut passes_completed = max_passes.max(1);
            for pass in 1..=max_passes {
                if control.is_cancelled() {
                    let _ = client.cancel(&acp_session_id).await;
                    return Err(AssessmentFailure::cancelled(
                        "cancelled",
                        "user requested cancel",
                    ));
                }

                emit_session_event(
                    controller,
                    build_progress_event(
                        controller,
                        run_id,
                        worker,
                        pass - 1,
                        max_passes,
                        &format!("{swarm} pass {pass}/{max_passes}"),
                        "prompting",
                        pass,
                        max_passes,
                        "pass_started",
                        started_at.elapsed().as_millis() as u64,
                        sweep_id,
                    ),
                )
                .await;

                let prompt = build_acp_prompt(
                    swarm,
                    pass,
                    max_passes,
                    &controller.project_root,
                    worker,
                    &known_titles,
                );
                let mut prompt_fut = Box::pin(client.prompt(PromptRequest {
                    session_id: acp_session_id.clone(),
                    prompt: vec![ContentBlock::Text { text: prompt }],
                }));
                let mut transcript = String::new();
                let mut terminal_seen = false;

                loop {
                    tokio::select! {
                        prompt_res = &mut prompt_fut => {
                            if let Err(e) = prompt_res {
                                return Err(AssessmentFailure::failed("worker_prompt_failed", e.to_string()));
                            }
                        }
                        ev = worker_rx.recv() => {
                            let ev = match ev {
                                Ok(ev) => ev,
                                Err(RecvError::Lagged(_)) => continue,
                                Err(RecvError::Closed) => {
                                    return Err(AssessmentFailure::failed("worker_closed", "ACP worker channel closed"));
                                }
                            };
                            match ev.event_type.as_str() {
                                "transcript.delta" => {
                                    if let Some(delta) = ev.payload.get("delta").and_then(Value::as_str) {
                                        transcript.push_str(delta);
                                    }
                                }
                                "transcript.completed" => {
                                    terminal_seen = true;
                                }
                                "transcript.error" => {
                                    let detail = ev
                                        .payload
                                        .get("error")
                                        .or_else(|| ev.payload.get("reason"))
                                        .and_then(Value::as_str)
                                        .unwrap_or("prompt failed")
                                        .to_string();
                                    return Err(AssessmentFailure::failed("worker_prompt_failed", detail));
                                }
                                _ => {}
                            }
                            if terminal_seen {
                                break;
                            }
                        }
                        _ = control.notify.notified(), if control.is_cancelled() => {
                            let _ = client.cancel(&acp_session_id).await;
                            return Err(AssessmentFailure::cancelled("cancelled", "user requested cancel"));
                        }
                        _ = tokio::time::sleep_until(deadline) => {
                            let _ = client.cancel(&acp_session_id).await;
                            return Err(AssessmentFailure::failed("worker_timeout", "assessment worker timed out"));
                        }
                    }
                }

                let candidates = match parse_acp_candidate_payload_full(&transcript) {
                    Ok((candidates, None)) => candidates,
                    Ok((_, Some(rejection))) => {
                        // The worker emitted a recognisable v1 envelope but it
                        // failed validation. The contract is broken even if a
                        // few candidates would have parsed via the heuristic;
                        // emit assessment.worker_output_rejected so operators
                        // can see the structured reason, then fail the run.
                        emit_worker_output_rejected(
                            controller,
                            run_id,
                            worker,
                            pass,
                            max_passes,
                            &rejection.code,
                            &rejection.message,
                            rejection.path.as_deref(),
                            &transcript,
                        )
                        .await;
                        return Err(AssessmentFailure::failed(
                            "invalid_worker_output",
                            rejection.message.clone(),
                        ));
                    }
                    Err(detail) => {
                        // Worker output didn't even parse as JSON. Surface
                        // it under the same channel so the cockpit gets a
                        // single "worker output rejected" treatment.
                        emit_worker_output_rejected(
                            controller,
                            run_id,
                            worker,
                            pass,
                            max_passes,
                            "unparseable",
                            &detail,
                            None,
                            &transcript,
                        )
                        .await;
                        return Err(AssessmentFailure::failed("invalid_worker_output", detail));
                    }
                };
                let mut tracker = AssessmentValidationTracker::default();
                let mut new_findings = 0usize;
                for candidate in candidates {
                    match process_candidate(
                        controller,
                        worker,
                        run_id,
                        "assessment.worker_prompt",
                        &candidate,
                        stats,
                        &mut tracker,
                    )
                    .await
                    {
                        Ok(Some(found)) => {
                            known_titles.push(found.title.clone());
                            new_findings += 1;
                        }
                        Ok(None) => {}
                        Err(_) => {}
                    }
                }

                passes_completed = pass;
                let pass_reason = if new_findings == 0 {
                    "no_new_findings"
                } else {
                    "pass_complete"
                };
                emit_session_event(
                    controller,
                    build_progress_event(
                        controller,
                        run_id,
                        worker,
                        passes_completed,
                        max_passes,
                        &format!("{swarm} pass {pass}/{max_passes}"),
                        "validation",
                        pass,
                        max_passes,
                        pass_reason,
                        started_at.elapsed().as_millis() as u64,
                        sweep_id,
                    ),
                )
                .await;

                if new_findings == 0 {
                    break;
                }
            }
            Ok(passes_completed)
        }
        AgentKind::Mock | AgentKind::VacNative => {
            let worker_cmd = ClientCommand {
                id: format!("cmd_{}", Ulid::new()),
                session_id: worker.id.clone(),
                cmd_type: "assessment.run".into(),
                payload: json!({
                    "swarm": swarm,
                    "depth": depth.as_str(),
                    "agent_role": agent_role,
                }),
                v: 1,
            };
            worker
                .send_client_command(&worker_cmd)
                .await
                .map_err(|e| AssessmentFailure::failed("worker_command_failed", e.to_string()))?;

            loop {
                if control.is_cancelled() {
                    let cancel_cmd = ClientCommand {
                        id: format!("cmd_{}", Ulid::new()),
                        session_id: worker.id.clone(),
                        cmd_type: "assessment.cancel".into(),
                        payload: json!({ "run_id": run_id }),
                        v: 1,
                    };
                    let _ = worker.send_client_command(&cancel_cmd).await;
                    return Err(AssessmentFailure::cancelled(
                        "cancelled",
                        "user requested cancel",
                    ));
                }

                tokio::select! {
                    ev = worker_rx.recv() => {
                        let ev = match ev {
                            Ok(ev) => ev,
                            Err(RecvError::Lagged(_)) => continue,
                            Err(RecvError::Closed) => {
                                return Err(AssessmentFailure::failed("worker_closed", "assessment worker channel closed"));
                            }
                        };

                        match ev.event_type.as_str() {
                            "assessment.progress" => {
                                let payload = augment_payload(
                                    ev.payload,
                                    &[
                                        ("run_id", json!(run_id)),
                                        ("agent_role", json!("assessment-worker")),
                                        ("worker_session_id", json!(worker.id)),
                                        ("phase", json!("worker")),
                                        ("pass", json!(1)),
                                        ("max_passes", json!(max_passes)),
                                        ("reason", json!("worker_progress")),
                                        ("elapsed_ms", json!(started_at.elapsed().as_millis() as u64)),
                                    ],
                                );
                                emit_controller_event(controller, "assessment.progress", payload).await;
                            }
                            "assessment.candidate_received" => {
                                let payload = augment_payload(
                                    ev.payload,
                                    &[
                                        ("run_id", json!(run_id)),
                                        ("agent_role", json!("assessment-worker")),
                                        ("worker_session_id", json!(worker.id)),
                                    ],
                                );
                                stats.received += payload
                                    .get("candidate_count")
                                    .and_then(Value::as_u64)
                                    .unwrap_or(1) as usize;
                                emit_controller_event(controller, "assessment.candidate_received", payload).await;
                            }
                            "assessment.candidate_rejected" => {
                                let payload = augment_payload(
                                    ev.payload,
                                    &[
                                        ("run_id", json!(run_id)),
                                        ("agent_role", json!("assessment-worker")),
                                        ("worker_session_id", json!(worker.id)),
                                    ],
                                );
                                stats.record_rejection();
                                emit_controller_event(controller, "assessment.candidate_rejected", payload).await;
                            }
                            "assessment.evidence_attached" => {
                                let payload = augment_payload(
                                    ev.payload,
                                    &[
                                        ("run_id", json!(run_id)),
                                        ("agent_role", json!("assessment-worker")),
                                        ("worker_session_id", json!(worker.id)),
                                    ],
                                );
                                emit_controller_event(controller, "assessment.evidence_attached", payload).await;
                            }
                            "assessment.finding_added" => {
                                let payload = augment_payload(
                                    ev.payload,
                                    &[
                                        ("run_id", json!(run_id)),
                                        ("agent_role", json!("assessment-worker")),
                                        ("worker_session_id", json!(worker.id)),
                                    ],
                                );
                                let category = payload
                                    .get("category")
                                    .and_then(Value::as_str)
                                    .map(CategoryBucket::from_str)
                                    .unwrap_or(CategoryBucket::Technical);
                                let severity = payload
                                    .get("severity")
                                    .and_then(Value::as_str)
                                    .map(SeverityBucket::from_str)
                                    .unwrap_or(SeverityBucket::Medium);
                                let title = payload
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("candidate")
                                    .to_string();
                                stats.record_finding(title, category, severity);
                                emit_controller_event(controller, "assessment.finding_added", payload).await;
                            }
                            "assessment.completed" => {
                                break;
                            }
                            "assessment.failed" => {
                                let detail = ev
                                    .payload
                                    .get("detail")
                                    .or_else(|| ev.payload.get("reason"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("worker failed")
                                    .to_string();
                                return Err(AssessmentFailure::failed("worker_failed", detail));
                            }
                            _ => {}
                        }
                    }
                    _ = tokio::time::sleep_until(deadline) => {
                        return Err(AssessmentFailure::failed("worker_timeout", "assessment worker timed out"));
                    }
                }
            }

            Ok(1)
        }
    }
}
