//! Scripted scenarios the mock-engine supports.

use serde_json::{json, Value};

/// Per-session state. Seeded counters keep output deterministic.
pub struct State {
    pub seed: u64,
    #[allow(dead_code)]
    pub session_id: String,
    #[allow(dead_code)]
    pub profile_id: Option<String>,
    pub counter: u64,
}

impl State {
    pub fn new(seed: u64, session_id: String, profile_id: Option<String>) -> Self {
        Self {
            seed,
            session_id,
            profile_id,
            counter: 0,
        }
    }

    fn next_msg_id(&mut self) -> String {
        self.counter += 1;
        format!("msg_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    fn next_tool_call_id(&mut self) -> String {
        self.counter += 1;
        format!("tc_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    #[allow(dead_code)]
    fn next_job_id(&mut self) -> String {
        self.counter += 1;
        format!("job_01J{:0>20}{:0>3}", self.seed % 10000, self.counter)
    }

    fn next_shell_id(&mut self) -> String {
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
        "message.submit" => handle_message_submit(id, params, state),
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
        "approval.approve" | "approval.reject" => handle_approval(id, method, params),
        "review.open_file" => handle_review_open(id, params),
        "review.revert_file" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification("changeset.file.reverted", json!({ "path": path })),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "review.revert_all" => vec![
            emit_notification("changeset.updated", json!({ "files": [] })),
            emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
        ],
        "runtime.cancel_job" => {
            let job_id = params
                .get("job_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "runtime.job.upserted",
                    json!({
                        "job_id": job_id,
                        "kind": "watcher",
                        "label": "watcher",
                        "status": "cancelled",
                        "finished_at": "2026-04-24T10:05:00Z"
                    }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "shell.start" => handle_shell_start(id, params, state),
        "shell.input" => {
            let sh = params
                .get("shell_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let data = params
                .get("data")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                // Echo input back so mock terminal shows typing.
                emit_notification(
                    "shell.output",
                    json!({ "shell_id": sh, "data": data }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "shell.resize" | "shell.kill" => {
            vec![emit_response(id.unwrap_or(Value::Null), json!({ "ok": true }))]
        }
        "connector.list" => vec![
            emit_notification("connector.list", json!({ "connectors": connector_catalog() })),
            emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
        ],
        "connector.connect" => {
            let provider = params
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "connector.oauth_url",
                    json!({
                        "provider": provider,
                        "url": format!("https://example.invalid/oauth/{provider}?state=mock")
                    }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "connector.disconnect" => {
            let cid = params
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "connector.health",
                    json!({ "id": cid, "health": "disconnected" }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "context.mention_search" => handle_mention_search(id, params),
        "assessment.run" => handle_assessment_run(id, params, state),
        "assessment.cancel" => {
            let run_id = params
                .get("run_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "assessment.completed",
                    json!({ "run_id": run_id, "verdict": "unknown" }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "assessment.fetch_evidence_preview" => {
            let eid = params
                .get("evidence_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "assessment.evidence_preview",
                    json!({
                        "id": eid,
                        "preview": format!("(mock preview for {eid})\n  line 1\n  line 2\n  line 3")
                    }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "gate.signoff" | "gate.override" => {
            vec![emit_response(id.unwrap_or(Value::Null), json!({ "ok": true }))]
        }
        "handoff.create" => handle_handoff_create(id, params, state),
        "handoff.approve" => handle_handoff_approve(id, params),
        "handoff.reject" => {
            let pid = params
                .get("packet_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                emit_notification(
                    "handoff.status",
                    json!({ "packet_id": pid, "status": "rejected" }),
                ),
                emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
            ]
        }
        "handoff.dispatch_local" => handle_handoff_dispatch(id, params, state),
        "release.list_targets" => vec![
            emit_notification(
                "release.targets",
                json!({
                    "targets": [
                        { "id": "staging", "label": "Staging", "environment": "staging", "last_status": "idle" },
                        { "id": "prod",    "label": "Production", "environment": "production", "last_status": "idle" }
                    ]
                }),
            ),
            emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
        ],
        "release.deploy" => handle_release_deploy(id, params, state),
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
        "release.generate_notes" => handle_release_notes(id, params, state),
        "session.close" => vec![
            emit_notification("session.closed", json!({ "reason": "user" })),
            emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
        ],
        "" => vec![emit_error(id, -32600, "missing method")],
        other => vec![emit_error(
            id,
            -32601,
            &format!("method not found: {other}"),
        )],
    }
}

fn handle_message_submit(id: Option<Value>, _params: Value, state: &mut State) -> Vec<String> {
    let msg_id = state.next_msg_id();
    let tc_id = state.next_tool_call_id();
    let mut out = Vec::with_capacity(10);
    out.push(emit_notification(
        "transcript.message_added",
        json!({
            "message_id": msg_id,
            "role": "assistant",
            "created_at": "2026-04-24T10:00:00Z"
        }),
    ));
    for chunk in ["I'll ", "edit ", "a ", "file.", ""] {
        out.push(emit_notification(
            "transcript.delta",
            json!({ "message_id": msg_id, "delta": chunk }),
        ));
    }
    out.push(emit_notification(
        "transcript.completed",
        json!({
            "message_id": msg_id,
            "usage": { "input_tokens": 10, "output_tokens": 5 }
        }),
    ));
    // Emit a pending tool_call + a fake changeset so Phase 3 tabs light up.
    out.push(emit_notification(
        "tool_call.pending",
        json!({
            "tool_call_id": tc_id,
            "tool": "edit_file",
            "risk": "medium",
            "summary": "Edit src/foo.ts",
            "args": { "path": "src/foo.ts", "patch": "-- old\n++ new\n" },
            "created_at": "2026-04-24T10:00:01Z"
        }),
    ));
    out.push(emit_notification(
        "changeset.updated",
        json!({
            "files": [
                { "path": "src/foo.ts", "status": "modified", "additions": 3, "deletions": 1 }
            ]
        }),
    ));
    out.push(emit_response(
        id.unwrap_or(Value::Null),
        json!({ "ok": true, "message_id": msg_id }),
    ));
    out
}

fn handle_approval(id: Option<Value>, method: &str, params: Value) -> Vec<String> {
    let tc_id = params
        .get("tool_call_id")
        .and_then(|v| v.as_str())
        .or_else(|| params.get("approval_id").and_then(|v| v.as_str()))
        .unwrap_or("tc_unknown")
        .to_string();
    let decision = if method == "approval.approve" {
        "approved"
    } else {
        "rejected"
    };
    vec![
        emit_notification(
            "tool_call.decided",
            json!({ "tool_call_id": tc_id, "decision": decision }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
    ]
}

fn handle_review_open(id: Option<Value>, params: Value) -> Vec<String> {
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let unified = format!(
        "--- a/{path}\n+++ b/{path}\n@@ -1,3 +1,3 @@\n-old line\n+new line\n unchanged\n"
    );
    vec![
        emit_notification(
            "changeset.file.diff_chunk",
            json!({ "path": path, "unified": unified, "truncated": false }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
    ]
}

fn handle_shell_start(id: Option<Value>, _params: Value, state: &mut State) -> Vec<String> {
    let shell_id = state.next_shell_id();
    vec![
        emit_notification(
            "shell.started",
            json!({ "shell_id": shell_id }),
        ),
        emit_notification(
            "shell.output",
            json!({ "shell_id": shell_id, "data": "mock-shell $ " }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true, "shell_id": shell_id })),
    ]
}

fn connector_catalog() -> Vec<Value> {
    let providers = [
        ("github", "connected", "connected"),
        ("notion", "connected", "connected"),
        ("sentry", "connected", "degraded"),
        ("datadog", "connected", "connected"),
        ("grafana", "connected", "connected"),
        ("vercel", "connected", "connected"),
        ("cloudflare", "connected", "connected"),
        ("posthog", "connected", "connected"),
        ("ga4", "connected", "connected"),
        ("mixpanel", "connected", "connected"),
        ("snyk", "connected", "connected"),
        ("dependabot", "connected", "connected"),
        ("lighthouse_ci", "connected", "connected"),
        ("pagerduty", "connected", "connected"),
    ];
    providers
        .iter()
        .map(|(p, _, health)| {
            json!({
                "id": format!("{p}_default"),
                "provider": p,
                "label": titlecase(p),
                "health": health,
                "account": format!("{p}-account"),
                "rate_limit": { "remaining": 4800, "limit": 5000, "reset_at": "2026-04-24T11:00:00Z" }
            })
        })
        .collect()
}

fn titlecase(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(ch) => ch.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn handle_release_deploy(id: Option<Value>, params: Value, state: &mut State) -> Vec<String> {
    let target = params
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    state.counter += 1;
    let deploy_id = format!("dep_{:0>12}{:0>3}", state.seed % 10000, state.counter);
    let commit = format!("{:040x}", state.counter.wrapping_mul(0xDEAD_BEEF));
    vec![
        emit_notification(
            "release.deploy_progress",
            json!({
                "deploy_id": deploy_id,
                "target_id": target,
                "commit": commit,
                "status": "deploying",
                "started_at": "2026-04-24T10:00:00Z"
            }),
        ),
        emit_notification(
            "release.deploy_progress",
            json!({
                "deploy_id": deploy_id,
                "target_id": target,
                "commit": commit,
                "status": "deployed",
                "started_at": "2026-04-24T10:00:00Z",
                "finished_at": "2026-04-24T10:00:08Z"
            }),
        ),
        emit_notification(
            "release.post_deploy_observation",
            json!({
                "id": format!("obs_{deploy_id}_1"),
                "target_id": target,
                "connector": "sentry",
                "severity": "info",
                "message": "no new issues in 5-minute window",
                "observed_at": "2026-04-24T10:05:00Z"
            }),
        ),
        emit_response(
            id.unwrap_or(Value::Null),
            json!({ "ok": true, "deploy_id": deploy_id }),
        ),
    ]
}

fn handle_release_notes(id: Option<Value>, params: Value, state: &mut State) -> Vec<String> {
    let target = params
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    state.counter += 1;
    let markdown = "\
## What changed

- Auto-resolved RTD finding: coverage drift
- Handoff pkt_01…: 3 tasks completed

## Deploy window

commit range: abc1234..def5678
"
    .to_string();
    vec![
        emit_notification(
            "release.notes_draft",
            json!({
                "id": format!("notes_{target}_{}", state.counter),
                "target_id": target,
                "commit_range": "abc1234..def5678",
                "markdown": markdown,
                "source_refs": [
                    { "kind": "commit", "ref": "abc1234" },
                    { "kind": "packet", "ref": "pkt_01" }
                ],
                "generated_at": "2026-04-24T10:00:00Z"
            }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
    ]
}

/// Canonical agent catalog per assessor family. Phase 6 ships the full 12.
/// (agent, category, check).
fn family_catalog(family: &str) -> Vec<(&'static str, &'static str, &'static str)> {
    match family {
        "pm" => vec![
            ("discovery",    "product", "user_interviews"),
            ("pricing",      "product", "pricing_alignment"),
            ("positioning",  "product", "market_fit"),
            ("competition",  "product", "landscape_scan"),
            ("metrics",      "product", "north_star"),
            ("go_to_market", "release", "launch_plan"),
            ("synthesizer",  "product", "verdict"),
        ],
        "ux" => vec![
            ("flows",        "ux", "task_completion"),
            ("a11y",         "ux", "wcag_aa"),
            ("copy",         "ux", "voice_tone"),
            ("visual",       "ux", "contrast"),
            ("synthesizer",  "ux", "verdict"),
        ],
        "frontend" => vec![
            ("bundle_size",  "technical", "budget"),
            ("a11y_axe",     "ux",        "axe_violations"),
            ("perf_lh",      "technical", "lighthouse_score"),
            ("hydration",    "technical", "island_cost"),
            ("synthesizer",  "technical", "verdict"),
        ],
        "security" => vec![
            ("deps",         "technical", "vuln_scan"),
            ("secrets",      "technical", "leaked_secrets"),
            ("authz",        "technical", "authorization_matrix"),
            ("sbom",         "ops",       "supply_chain"),
            ("synthesizer",  "technical", "verdict"),
        ],
        "reliability" => vec![
            ("slo",          "ops", "slo_burn"),
            ("chaos",        "ops", "fault_injection"),
            ("backup",       "ops", "backup_restore"),
            ("runbooks",     "ops", "coverage"),
            ("synthesizer",  "ops", "verdict"),
        ],
        "performance" => vec![
            ("bench_api",    "technical", "p95_latency"),
            ("bench_render", "technical", "tti"),
            ("memory",       "technical", "growth"),
            ("synthesizer",  "technical", "verdict"),
        ],
        "qa" => vec![
            ("unit",         "technical", "coverage"),
            ("integration",  "technical", "smoke"),
            ("e2e",          "technical", "critical_paths"),
            ("regression",   "technical", "baseline_diff"),
            ("synthesizer",  "technical", "verdict"),
        ],
        "docs" => vec![
            ("readme",       "release", "freshness"),
            ("api_docs",     "release", "coverage"),
            ("changelog",    "release", "up_to_date"),
            ("synthesizer",  "release", "verdict"),
        ],
        "launch" => vec![
            ("announce",     "release", "copy_ready"),
            ("rollout",      "release", "stage_plan"),
            ("support",      "ops",     "handover"),
            ("synthesizer",  "release", "verdict"),
        ],
        "release" => vec![
            ("gate_check",   "release", "gate_matrix"),
            ("rollback",     "release", "plan_exists"),
            ("compliance",   "release", "legal_ok"),
            ("synthesizer",  "release", "verdict"),
        ],
        "growth" => vec![
            ("funnel",       "product", "activation"),
            ("retention",    "product", "d7_d30"),
            ("virality",     "product", "k_factor"),
            ("synthesizer",  "product", "verdict"),
        ],
        // Default RTD.
        _ => vec![
            ("code_health",   "technical", "coverage_drift"),
            ("test_coverage", "technical", "branch_coverage"),
            ("security",      "technical", "dep_audit"),
            ("observability", "ops",       "trace_hygiene"),
            ("release_gate",  "release",   "verdict"),
        ],
    }
}

fn handle_handoff_create(id: Option<Value>, params: Value, state: &mut State) -> Vec<String> {
    state.counter += 1;
    let pid = format!("pkt_01J{:0>20}{:0>3}", state.seed % 10000, state.counter);
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Handoff")
        .to_string();
    let author = params
        .get("author")
        .and_then(|v| v.as_str())
        .unwrap_or("author")
        .to_string();
    let target_profile = params
        .get("target_profile")
        .and_then(|v| v.as_str())
        .unwrap_or("executor.code@1.0.0")
        .to_string();
    let policy = params
        .get("policy")
        .and_then(|v| v.as_str())
        .unwrap_or("strict")
        .to_string();
    let tasks = params
        .get("tasks")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));

    // Deterministic 64-hex pin; real worktree_digest lands with upstream PR #8.
    let seed = state.counter.wrapping_mul(0x9E37_79B9);
    let digest = format!("{:016x}{:016x}{:016x}{:016x}", seed, seed ^ 0xaaaa, seed ^ 0x5555, seed ^ 0xffff);
    let base_sha = format!("{:040x}", seed);

    vec![
        emit_notification(
            "handoff.upserted",
            json!({
                "packet_id": pid,
                "title": title,
                "target_profile": target_profile,
                "status": "pending_approval",
                "tasks": tasks,
                "pin": {
                    "worktree_digest": digest,
                    "base_sha": base_sha,
                    "captured_at": "2026-04-24T10:00:00Z",
                    "policy": policy,
                    "connector_snapshots": [{ "connector": "github", "snapshot_id": "snap_1" }]
                },
                "signers": [
                    { "role": "author", "name": author, "signed_at": "2026-04-24T10:00:00Z" }
                ],
                "required_signers": 2,
                "convergence_count": 0,
                "created_at": "2026-04-24T10:00:00Z",
                "updated_at": "2026-04-24T10:00:00Z"
            }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true, "packet_id": pid })),
    ]
}

fn handle_handoff_approve(id: Option<Value>, params: Value) -> Vec<String> {
    let pid = params
        .get("packet_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let approver = params
        .get("approver")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let reason = params
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("approved")
        .to_string();
    // Bridge-side self-sign check already runs; here we echo the signer event
    // plus a status → approved transition assuming threshold met.
    vec![
        emit_notification(
            "handoff.upserted",
            json!({
                "packet_id": pid,
                "status": "approved",
                "signers": [
                    { "role": "approver", "name": approver, "signed_at": "2026-04-24T10:05:00Z", "reason": reason }
                ]
            }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
    ]
}

fn handle_handoff_dispatch(id: Option<Value>, params: Value, state: &mut State) -> Vec<String> {
    let pid = params
        .get("packet_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    state.counter += 1;
    let exec_sid = format!("exec_{:0>12}{:0>3}", state.seed % 10000, state.counter);
    vec![
        emit_notification(
            "handoff.status",
            json!({ "packet_id": pid, "status": "executing" }),
        ),
        emit_notification(
            "handoff.dispatch_progress",
            json!({
                "packet_id": pid,
                "executor_session_id": exec_sid,
                "current_task": "t1",
                "completed": 0,
                "total": 1
            }),
        ),
        emit_notification(
            "handoff.dispatch_progress",
            json!({
                "packet_id": pid,
                "executor_session_id": exec_sid,
                "current_task": "t1",
                "completed": 1,
                "total": 1
            }),
        ),
        emit_notification(
            "handoff.status",
            json!({ "packet_id": pid, "status": "completed" }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true, "executor_session_id": exec_sid })),
    ]
}

fn handle_assessment_run(id: Option<Value>, params: Value, state: &mut State) -> Vec<String> {
    let swarm = params
        .get("swarm")
        .and_then(|v| v.as_str())
        .unwrap_or("rtd")
        .to_string();
    state.counter += 1;
    let run_id = format!("run_01J{:0>20}{:0>3}", state.seed % 10000, state.counter);
    let agents: Vec<(&str, &str, &str)> = family_catalog(&swarm);

    let mut out: Vec<String> = Vec::with_capacity(agents.len() * 3 + 4);
    out.push(emit_notification(
        "assessment.started",
        json!({
            "run_id": run_id,
            "swarm": swarm,
            "total_checks": agents.len(),
            "started_at": "2026-04-24T10:00:00Z"
        }),
    ));

    let mut total_findings = 0u64;
    for (i, (agent, category, check)) in agents.iter().enumerate() {
        out.push(emit_notification(
            "assessment.progress",
            json!({
                "run_id": run_id,
                "completed": i,
                "total": agents.len(),
                "current": agent
            }),
        ));
        // Skip finding emission for the synthesizer agent.
        if *agent == "synthesizer" || *agent == "release_gate" {
            continue;
        }
        total_findings += 1;
        let fid = format!("f_{run_id}_{i}");
        let eid = format!("ev_{run_id}_{i}");
        // 64-hex-char deterministic stand-in for sha256(category|subject|check).
        // Real identity hash lands when upstream PR #7 ships; the field shape
        // (64 hex chars) is what matters for web-side dedup today.
        let seed = format!("{}|{}|{}", category, agent, check)
            .bytes()
            .fold(0u64, |a, b| a.wrapping_mul(31).wrapping_add(b as u64));
        let identity = format!("{:016x}{:016x}{:016x}{:016x}", seed, seed ^ 0xa5, seed ^ 0x5a, seed ^ 0xff);
        // Evidence first so the finding's evidence_ids resolve.
        out.push(emit_notification(
            "assessment.evidence",
            json!({
                "id": eid,
                "connector": if i % 2 == 0 { "github" } else { "notion" },
                "kind": "artifact",
                "label": format!("{agent}_evidence_{i}"),
                "captured_at": "2026-04-24T09:59:00Z",
                "ttl_seconds": 3600
            }),
        ));
        out.push(emit_notification(
            "assessment.finding",
            json!({
                "finding_id": fid,
                "identity_hash": identity,
                "run_id": run_id,
                "category": category,
                "subject": format!("{agent} subject"),
                "check": check,
                "severity": if i == 0 { "high" } else if i == 1 { "medium" } else { "low" },
                "confidence": 0.8,
                "title": format!("{agent}: {check}"),
                "summary": format!("Automated {check} surfaced a {category} concern in {agent}."),
                "evidence_ids": [eid],
                "emitted_at": "2026-04-24T10:00:01Z"
            }),
        ));
    }

    out.push(emit_notification(
        "assessment.progress",
        json!({
            "run_id": run_id,
            "completed": agents.len(),
            "total": agents.len(),
            "current": "synthesizer"
        }),
    ));

    let verdict = if total_findings >= 3 { "warn" } else { "pass" };
    out.push(emit_notification(
        "assessment.completed",
        json!({
            "run_id": run_id,
            "verdict": verdict,
            "score": {
                "technical": 0.78,
                "product": 0.72,
                "ux": 0.65,
                "release": if verdict == "pass" { 0.9 } else { 0.7 },
                "ops": 0.81
            }
        }),
    ));

    // DevComplete pass on any completion, ReadyToDeploy depends on verdict.
    out.push(emit_notification(
        "gate.changed",
        json!({
            "id": "DevComplete",
            "state": "pass",
            "summary": "RTD run completed",
            "criteria": [
                { "id": "ci_green", "label": "CI green", "satisfied": true },
                { "id": "tests_pass", "label": "Tests pass", "satisfied": true }
            ],
            "blockers": [],
            "required_signers": 1,
            "signers": []
        }),
    ));
    out.push(emit_notification(
        "gate.changed",
        json!({
            "id": "ReadyToDeploy",
            "state": if verdict == "pass" { "open" } else { "fail" },
            "summary": if verdict == "pass" { "Awaiting signoff" } else { "Verdict warns" },
            "criteria": [
                { "id": "verdict_pass", "label": "Assessment verdict pass", "satisfied": verdict == "pass" }
            ],
            "blockers": if verdict == "pass" { vec![] } else { vec!["verdict not pass".to_string()] },
            "required_signers": 2,
            "signers": []
        }),
    ));

    out.push(emit_response(
        id.unwrap_or(Value::Null),
        json!({ "ok": true, "run_id": run_id }),
    ));
    out
}

fn handle_mention_search(id: Option<Value>, params: Value) -> Vec<String> {
    let query = params
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let samples = ["src/foo.ts", "src/main.tsx", "docs/README.md", "package.json"];
    let results: Vec<Value> = samples
        .iter()
        .filter(|p| query.is_empty() || p.to_lowercase().contains(&query.to_lowercase()))
        .enumerate()
        .map(|(i, p)| {
            json!({
                "id": format!("file:{p}"),
                "kind": "file",
                "label": p,
                "score": 1.0 - (i as f64) * 0.1,
                "payload": p
            })
        })
        .collect();
    vec![
        emit_notification(
            "context.mention_results",
            json!({ "query": query, "results": results }),
        ),
        emit_response(id.unwrap_or(Value::Null), json!({ "ok": true })),
    ]
}
