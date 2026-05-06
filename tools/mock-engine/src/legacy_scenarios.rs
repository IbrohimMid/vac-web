//! Scripted scenarios the mock-engine supports.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Per-session state. Seeded counters keep output deterministic.
pub struct State {
    pub seed: u64,
    #[allow(dead_code)]
    pub session_id: String,
    #[allow(dead_code)]
    pub profile_id: Option<String>,
    #[allow(dead_code)]
    pub project: Option<String>,
    pub counter: u64,
}

impl State {
    pub fn new(
        seed: u64,
        session_id: String,
        profile_id: Option<String>,
        project: Option<String>,
    ) -> Self {
        Self {
            seed,
            session_id,
            profile_id,
            project,
            counter: 0,
        }
    }

    pub(crate) fn next_msg_id(&mut self) -> String {
        self.counter += 1;
        format!("msg_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    pub(crate) fn next_tool_call_id(&mut self) -> String {
        self.counter += 1;
        format!("tc_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    #[allow(dead_code)]
    pub(crate) fn next_job_id(&mut self) -> String {
        self.counter += 1;
        format!("job_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    pub(crate) fn next_shell_id(&mut self) -> String {
        self.counter += 1;
        format!("sh_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }
}

pub fn emit_notification(method: &str, params: Value) -> String {
    let v = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    serde_json::to_string(&v).unwrap()
}

pub fn emit_response(id: Value, result: Value) -> String {
    let v = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    serde_json::to_string(&v).unwrap()
}

pub fn emit_error(id: Option<Value>, code: i32, message: &str) -> String {
    let v = json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message }
    });
    serde_json::to_string(&v).unwrap()
}

#[derive(Debug, Clone)]
pub(crate) struct RepoContext {
    pub(crate) repo_ref: String,
    pub(crate) base_commit_sha: String,
    #[allow(dead_code)]
    pub(crate) worktree_digest: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn deterministic_hex(seed: u64) -> String {
    format!(
        "{:016x}{:016x}{:016x}{:016x}",
        seed,
        seed ^ 0xaaaa,
        seed ^ 0x5555,
        seed ^ 0xffff
    )
}

fn git_output(project: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8(out.stdout).ok()?;
    let trimmed = stdout.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn compute_worktree_digest(project: &Path) -> Option<String> {
    let out = Command::new("git")
        .current_dir(project)
        .args(["ls-files", "-z"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for entry in out
        .stdout
        .split(|b| *b == 0)
        .filter(|entry| !entry.is_empty())
    {
        let rel = String::from_utf8_lossy(entry).to_string();
        let file = project.join(&rel);
        let bytes = fs::read(&file).unwrap_or_default();
        parts.push(format!("{rel}:{}", sha256_hex(&bytes)));
    }
    parts.sort();
    Some(sha256_hex(parts.join("\n").as_bytes()))
}

pub(crate) fn repo_context(project: Option<&str>, seed: u64) -> RepoContext {
    let project_path = project.map(Path::new);
    let base_commit_sha = project_path
        .and_then(|path| git_output(path, &["rev-parse", "HEAD"]))
        .unwrap_or_else(|| deterministic_hex(seed).chars().take(40).collect());
    let repo_ref = project_path
        .and_then(|path| git_output(path, &["branch", "--show-current"]))
        .filter(|branch| !branch.is_empty())
        .map(|branch| format!("branch:{branch}"))
        .or_else(|| {
            project_path
                .and_then(|path| git_output(path, &["describe", "--tags", "--exact-match"]))
                .filter(|tag| !tag.is_empty())
                .map(|tag| format!("tag:{tag}"))
        })
        .unwrap_or_else(|| format!("sha:{base_commit_sha}"));
    let worktree_digest = project_path
        .and_then(compute_worktree_digest)
        .unwrap_or_else(|| deterministic_hex(seed ^ 0xDEADBEEF));
    RepoContext {
        repo_ref,
        base_commit_sha,
        worktree_digest,
    }
}

pub fn handle(line: &str, state: &mut State) -> Vec<String> {
    let parsed: Result<Value, _> = serde_json::from_str(line);
    let v = match parsed {
        Ok(v) => v,
        Err(e) => return vec![emit_error(None, -32700, &format!("parse error: {e}"))],
    };

    let id = v.get("id").cloned();
    let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = v.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "system.ping" => vec![emit_response(
            id.unwrap_or(Value::Null),
            json!({ "pong": true }),
        )],
        "system.version" => vec![emit_response(
            id.unwrap_or(Value::Null),
            json!({ "bridge": env!("CARGO_PKG_VERSION"), "engine": "mock-engine" }),
        )],
        "message.cancel_stream" => vec![
            emit_notification(
                "transcript.error",
                json!({
                    "message_id": params.get("message_id").cloned().unwrap_or(Value::Null),
                    "error": "cancelled"
                }),
            ),
            emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
        ],
        // approval.approve / approval.reject: ported to YAML runtime catalog
        // (approval-approve.yaml, approval-reject.yaml). The legacy or-fallback
        // to tool_call_id is intentionally dropped (web only sends approval_id).
        // review.open_file: ported to YAML runtime catalog (review-open-file.yaml).
        // scenarios::handle short-circuits before reaching this dispatcher for
        // all of the above.
        // review.revert_file + review.revert_all: ported to YAML runtime catalog
        // (review-revert-file.yaml, review-revert-all.yaml). scenarios::handle
        // short-circuits before reaching this dispatcher.

        // runtime.cancel_job: ported to YAML runtime catalog (runtime-cancel-job.yaml).
        // shell.start / shell.input / shell.resize / shell.kill: ported to YAML runtime
        // catalog (shell-basic-output.yaml, shell-input.yaml, shell-resize.yaml,
        // shell-kill.yaml). connector.list / connector.connect / connector.disconnect:
        // ported to YAML runtime catalog (connector-list.yaml, connector-connect.yaml,
        // connector-disconnect.yaml). scenarios::handle short-circuits before reaching
        // this dispatcher for all of the above.
        // assessment.run: ported to YAML runtime catalog (assessment-run.yaml) via
        // Pass #36 foreach over @assessment_family_catalog + condition primitive on
        // is_failure binding. scenarios::handle short-circuits before reaching this dispatcher.
        // assessment.cancel + assessment.fetch_evidence_preview + gate.signoff +
        // gate.override: ported to YAML runtime catalog. scenarios::handle
        // short-circuits before reaching this dispatcher.
        // handoff.reject + release.list_targets: ported to YAML runtime catalog
        // (handoff-reject.yaml, release-list-targets.yaml). scenarios::handle
        // short-circuits before reaching this dispatcher.
        // handoff.dispatch_local: ported to YAML runtime catalog
        // (handoff-dispatch-local.yaml) via Pass #34 condition primitive +
        // @executor_session_id / @handoff_dispatch_outcome generators.
        // scenarios::handle short-circuits before reaching this dispatcher.
        "release.publish" => {
            let target = params
                .get("target_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "release.deploy_progress",
                    json!({
                        "deploy_id": format!("pub_{target}_{}", state.counter),
                        "target_id": target,
                        "commit": format!("{:040x}", state.counter.wrapping_mul(0xC0_FFEE)),
                        "status": "deployed",
                        "started_at": "2026-04-24T10:00:00Z",
                        "finished_at": "2026-04-24T10:00:05Z"
                    }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        // session.close: ported to YAML runtime catalog (session-close.yaml).
        // scenarios::handle short-circuits before reaching this dispatcher.
        "" => vec![emit_error(id, -32600, "missing method")],
        other => vec![emit_error(
            id,
            -32601,
            &format!("method not found: {other}"),
        )],
    }
}

pub(crate) fn is_handoff_execution_submit(params: &Value) -> bool {
    params
        .get("handoff_packet_id")
        .and_then(|v| v.as_str())
        .is_some()
        || params
            .get("text")
            .and_then(|v| v.as_str())
            .map(|text| text.contains("VAC Web Handoff Packet"))
            .unwrap_or(false)
}

// handle_approval + handle_review_open: removed; their behavior was ported to
// YAML runtime catalog (approval-approve.yaml, approval-reject.yaml,
// review-open-file.yaml). Legacy or-fallback from approval_id to tool_call_id
// is intentionally dropped (web only sends approval_id).

// connector_catalog + titlecase helpers: removed; their data was inlined into
// tools/mock-engine/scenarios/connector-list.yaml (14 static connector entries
// with deterministic rate_limit + reset_at timestamps).

/// Canonical agent catalog per assessor family. Phase 6 ships the full 12.
/// (agent, category, check).
pub(crate) fn family_catalog(family: &str) -> Vec<(&'static str, &'static str, &'static str)> {
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
        // Default RTD.
        _ => vec![
            ("code_health", "technical", "coverage_drift"),
            ("test_coverage", "technical", "branch_coverage"),
            ("security", "technical", "dep_audit"),
            ("observability", "ops", "trace_hygiene"),
            ("release_gate", "release", "verdict"),
        ],
    }
}

/// Catalog of notification methods this mock-engine is allowed to emit.
///
/// Every entry is tagged either `Canonical` (event also emitted by
/// `apps/local-bridge` and therefore safe for parity tests) or `MockOnly`
/// (event the bridge does not emit; tests that only pass against
/// mock-engine must not rely on these to validate real wiring).
///
/// Slice 24 (`wiring.mock_engine_parity`) keeps this catalog in sync
/// with `apps/local-bridge/src/translator/mod.rs` so mock scenarios
/// cannot silently drift from canonical event names.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const NOTIFICATION_METHOD_CATALOG: &[(&str, NotificationParity)] = &[
    // Canonical events: also emitted by local-bridge translator.
    ("review.changeset_updated", NotificationParity::Canonical),
    ("session.closed", NotificationParity::Canonical),
    ("shell.output", NotificationParity::Canonical),
    ("shell.started", NotificationParity::Canonical),
    // Mock-only events: scaffolding for handoff dispatch tests.
    // Real local-bridge emits handoff.* events via translator/mod.rs but
    // these specific shapes (execution_progress, completed) are mock
    // scaffolding for the executor scenario.
    ("handoff.execution_progress", NotificationParity::MockOnly),
    ("handoff.completed", NotificationParity::MockOnly),
];

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NotificationParity {
    Canonical,
    MockOnly,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Slice 24 parity guard. Every notification method emitted from
    /// scenarios.rs must be declared in `NOTIFICATION_METHOD_CATALOG`.
    /// Adding a new emission without updating the catalog (or marking it
    /// MockOnly explicitly) is a wiring drift and fails this test.
    #[test]
    fn every_emitted_notification_method_is_catalogued() {
        let src = include_str!("scenarios.rs");
        // Match emit_notification call sites with a string-literal method.
        let mut emitted: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let needle = "emit_notification(\"";
        for (idx, _) in src.match_indices(needle) {
            let after = &src[idx + needle.len()..];
            if let Some(end) = after.find('"') {
                let method = &after[..end];
                // Skip placeholder-style tokens (e.g. angle-bracketed) so
                // doc comments and self-referential text don't trip the
                // parity scan.
                if method.is_empty() || method.contains('<') || method.contains('>') {
                    continue;
                }
                emitted.insert(method.to_string());
            }
        }
        let catalogued: std::collections::BTreeSet<String> = NOTIFICATION_METHOD_CATALOG
            .iter()
            .map(|(m, _)| (*m).to_string())
            .collect();
        let undeclared: Vec<_> = emitted.difference(&catalogued).cloned().collect();
        assert!(
            undeclared.is_empty(),
            "mock-engine emits notification methods not in NOTIFICATION_METHOD_CATALOG: {:?}. \
             Add each to scenarios.rs::NOTIFICATION_METHOD_CATALOG with Canonical or MockOnly tag.",
            undeclared,
        );
        // The catalog is allowed to list more (e.g. handoff.* shapes
        // emitted via inline json! macros) than this scan finds, but
        // the catalog is small enough that we also assert it isn't empty.
        assert!(
            !catalogued.is_empty(),
            "NOTIFICATION_METHOD_CATALOG must not be empty"
        );
    }

    /// Slice 24: at least one canonical event must be present, otherwise
    /// mock-engine has drifted away from canonical bridge wiring.
    #[test]
    fn catalog_has_at_least_one_canonical_event() {
        assert!(
            NOTIFICATION_METHOD_CATALOG
                .iter()
                .any(|(_, p)| *p == NotificationParity::Canonical),
            "mock-engine catalog has zero Canonical events; bridge parity is impossible."
        );
    }
}
