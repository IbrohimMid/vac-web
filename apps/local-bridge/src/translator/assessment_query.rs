use crate::server::AppStateHandle;
use crate::session::persistence::PersistedServerEvent;
use crate::translator::emit_session_event_live;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Default)]
struct AssessmentSnapshot {
    runs: HashMap<String, Value>,
    sweeps: HashMap<String, Value>,
    findings_by_run: HashMap<String, Vec<Value>>,
    evidence_by_run: HashMap<String, Vec<Value>>,
    run_event_counts: HashMap<String, usize>,
}

pub async fn dispatch_assessment_list_runs(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(persistence) = state.persistence.as_ref() else {
        return ack_error(
            &cmd.id,
            "persistence.disabled",
            "session persistence is not configured",
        );
    };
    let events = match persistence.load_events(&cmd.session_id, 0) {
        Ok(events) => events,
        Err(err) => {
            return ack_error(
                &cmd.id,
                "assessment.query_failed",
                format!("failed to load assessment history: {err}"),
            );
        }
    };

    let snapshot = build_snapshot(&events);
    let swarm_filter = cmd
        .payload
        .get("swarm")
        .and_then(Value::as_str)
        .map(str::to_string);
    let limit = cmd
        .payload
        .get("limit")
        .and_then(Value::as_u64)
        .map(|v| v as usize);

    let mut runs: Vec<Value> = snapshot
        .runs
        .values()
        .filter(|run| {
            if let Some(filter) = swarm_filter.as_deref() {
                run.get("swarm").and_then(Value::as_str) == Some(filter)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    runs.sort_by(|a, b| {
        let a_started = a.get("started_at").and_then(Value::as_str).unwrap_or("");
        let b_started = b.get("started_at").and_then(Value::as_str).unwrap_or("");
        a_started.cmp(b_started)
    });

    let mut sweeps: Vec<Value> = snapshot
        .sweeps
        .values()
        .filter(|sweep| {
            if let Some(filter) = swarm_filter.as_deref() {
                sweep
                    .get("families")
                    .and_then(Value::as_array)
                    .map(|families| families.iter().any(|f| f.as_str() == Some(filter)))
                    .unwrap_or(false)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    sweeps.sort_by(|a, b| {
        let a_started = a.get("started_at").and_then(Value::as_str).unwrap_or("");
        let b_started = b.get("started_at").and_then(Value::as_str).unwrap_or("");
        a_started.cmp(b_started)
    });

    if let Some(limit) = limit {
        if runs.len() > limit {
            runs.drain(0..runs.len() - limit);
        }
        if sweeps.len() > limit {
            sweeps.drain(0..sweeps.len() - limit);
        }
    }

    let active_run_id = runs
        .iter()
        .rev()
        .find(|run| run.get("status").and_then(Value::as_str) == Some("running"))
        .and_then(|run| run.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| runs.last().and_then(|run| run.get("id").and_then(Value::as_str)).map(str::to_string));

    let active_sweep_id = sweeps
        .iter()
        .rev()
        .find(|sweep| sweep.get("status").and_then(Value::as_str) == Some("running"))
        .and_then(|sweep| sweep.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| sweeps.last().and_then(|sweep| sweep.get("id").and_then(Value::as_str)).map(str::to_string));

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        emit_session_event_live(
            &controller,
            server_event(
                &cmd.session_id,
                "assessment.runs_listed",
                json!({
                    "source": "persistence",
                    "swarm": swarm_filter,
                    "limit": limit,
                    "active_run_id": active_run_id,
                    "active_sweep_id": active_sweep_id,
                    "runs": runs,
                    "sweeps": sweeps,
                }),
            ),
        )
        .await;
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

pub async fn dispatch_assessment_fetch_report(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    dispatch_assessment_report(cmd, state, "assessment.report_fetched", false).await
}

pub async fn dispatch_assessment_replay(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    dispatch_assessment_report(cmd, state, "assessment.replayed", true).await
}

pub async fn dispatch_assessment_diff(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(base_run_id) = cmd.payload.get("base_run_id").and_then(Value::as_str) else {
        return ack_error(
            &cmd.id,
            "assessment.invalid_payload",
            "assessment.diff requires base_run_id",
        );
    };
    let Some(next_run_id) = cmd.payload.get("next_run_id").and_then(Value::as_str) else {
        return ack_error(
            &cmd.id,
            "assessment.invalid_payload",
            "assessment.diff requires next_run_id",
        );
    };
    let snapshot = match load_snapshot(cmd, state) {
        Ok(snapshot) => snapshot,
        Err(error) => return error,
    };
    let Some(base) = snapshot.runs.get(base_run_id) else {
        return ack_error(
            &cmd.id,
            "assessment.not_found",
            format!("assessment run {base_run_id} not found"),
        );
    };
    let Some(next) = snapshot.runs.get(next_run_id) else {
        return ack_error(
            &cmd.id,
            "assessment.not_found",
            format!("assessment run {next_run_id} not found"),
        );
    };

    let prev = snapshot.findings_by_run.get(base_run_id).cloned().unwrap_or_default();
    let next_findings = snapshot
        .findings_by_run
        .get(next_run_id)
        .cloned()
        .unwrap_or_default();
    let diff = compute_diff(&prev, &next_findings);
    let counts = diff.get("counts").cloned().unwrap_or_else(|| json!({}));
    let entries = diff.get("entries").cloned().unwrap_or_else(|| json!([]));

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        emit_session_event_live(
            &controller,
            server_event(
                &cmd.session_id,
                "assessment.diffed",
                json!({
                    "source": "persistence",
                    "base_run_id": base_run_id,
                    "next_run_id": next_run_id,
                    "base_run": base,
                    "next_run": next,
                    "counts": counts,
                    "entries": entries,
                }),
            ),
        )
        .await;
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

pub async fn dispatch_assessment_fetch_evidence_preview(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(evidence_id) = cmd.payload.get("evidence_id").and_then(Value::as_str) else {
        return ack_error(
            &cmd.id,
            "assessment.invalid_payload",
            "assessment.fetch_evidence_preview requires evidence_id",
        );
    };
    let snapshot = match load_snapshot(cmd, state) {
        Ok(snapshot) => snapshot,
        Err(error) => return error,
    };
    let evidence = snapshot
        .evidence_by_run
        .values()
        .flat_map(|items| items.iter())
        .find(|item| item.get("id").and_then(Value::as_str) == Some(evidence_id));
    let Some(evidence) = evidence else {
        return ack_error(
            &cmd.id,
            "assessment.not_found",
            format!("evidence {evidence_id} not found"),
        );
    };

    let preview = build_evidence_preview(
        &cmd.session_id,
        state,
        evidence.get("uri").and_then(Value::as_str),
        evidence.get("locator"),
        evidence.get("label").and_then(Value::as_str),
    )
    .unwrap_or_else(|reason| format!("(preview unavailable: {reason})"));

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        emit_session_event_live(
            &controller,
            server_event(
                &cmd.session_id,
                "assessment.evidence_preview",
                json!({
                    "id": evidence_id,
                    "preview": preview,
                }),
            ),
        )
        .await;
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

async fn dispatch_assessment_report(
    cmd: &ClientCommand,
    state: &AppStateHandle,
    event_type: &str,
    include_report_mark: bool,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(run_id) = cmd.payload.get("run_id").and_then(Value::as_str) else {
        return ack_error(
            &cmd.id,
            "assessment.invalid_payload",
            format!("{event_type} requires run_id"),
        );
    };
    let snapshot = match load_snapshot(cmd, state) {
        Ok(snapshot) => snapshot,
        Err(error) => return error,
    };
    let Some(run) = snapshot.runs.get(run_id).cloned() else {
        return ack_error(
            &cmd.id,
            "assessment.not_found",
            format!("assessment run {run_id} not found"),
        );
    };
    let findings = snapshot.findings_by_run.get(run_id).cloned().unwrap_or_default();
    let evidence = snapshot.evidence_by_run.get(run_id).cloned().unwrap_or_default();
    let sweep = run
        .get("sweep_id")
        .and_then(Value::as_str)
        .and_then(|id| snapshot.sweeps.get(id))
        .cloned();
    let event_count = snapshot.run_event_counts.get(run_id).copied().unwrap_or(0);

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        let payload = json!({
            "source": "persistence",
            "run_id": run_id,
            "run": run,
            "findings": findings,
            "evidence": evidence,
            "sweep": sweep,
            "replayed_events": event_count,
        });
        emit_session_event_live(&controller, server_event(&cmd.session_id, event_type, payload)).await;
        if include_report_mark {
            emit_session_event_live(
                &controller,
                server_event(
                    &cmd.session_id,
                    "assessment.report_fetched",
                    json!({
                        "source": "persistence",
                        "run_id": run_id,
                        "run": run,
                        "findings": findings,
                        "evidence": evidence,
                        "sweep": sweep,
                        "replayed_events": event_count,
                    }),
                ),
            )
            .await;
        }
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

fn compute_diff(prev: &[Value], next: &[Value]) -> Value {
    let mut prev_by_hash: HashMap<String, Value> = HashMap::new();
    for finding in prev {
        if let Some(hash) = finding.get("identity_hash").and_then(Value::as_str) {
            prev_by_hash.insert(hash.to_string(), finding.clone());
        }
    }
    let mut next_by_hash: HashMap<String, Value> = HashMap::new();
    for finding in next {
        if let Some(hash) = finding.get("identity_hash").and_then(Value::as_str) {
            next_by_hash.insert(hash.to_string(), finding.clone());
        }
    }

    let sev_rank = |severity: Option<&str>| match severity.unwrap_or("info") {
        "critical" => 4,
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    };

    let mut entries = Vec::new();
    let mut counts = json!({
        "resolved": 0,
        "persistent": 0,
        "regressed": 0,
        "new": 0,
    });

    for (hash, prev_finding) in &prev_by_hash {
        match next_by_hash.get(hash) {
            None => {
                bump_count(&mut counts, "resolved");
                entries.push(json!({
                    "bucket": "resolved",
                    "identity_hash": hash,
                    "prev": prev_finding,
                }));
            }
            Some(next_finding) => {
                let prev_sev = prev_finding.get("severity").and_then(Value::as_str);
                let next_sev = next_finding.get("severity").and_then(Value::as_str);
                if sev_rank(next_sev) > sev_rank(prev_sev) {
                    bump_count(&mut counts, "regressed");
                    entries.push(json!({
                        "bucket": "regressed",
                        "identity_hash": hash,
                        "prev": prev_finding,
                        "next": next_finding,
                    }));
                } else {
                    bump_count(&mut counts, "persistent");
                    entries.push(json!({
                        "bucket": "persistent",
                        "identity_hash": hash,
                        "prev": prev_finding,
                        "next": next_finding,
                    }));
                }
            }
        }
    }

    for (hash, next_finding) in &next_by_hash {
        if !prev_by_hash.contains_key(hash) {
            bump_count(&mut counts, "new");
            entries.push(json!({
                "bucket": "new",
                "identity_hash": hash,
                "next": next_finding,
            }));
        }
    }

    json!({ "entries": entries, "counts": counts })
}

fn bump_count(counts: &mut Value, key: &str) {
    if let Some(obj) = counts.as_object_mut() {
        let next = obj.get(key).and_then(Value::as_u64).unwrap_or(0).saturating_add(1);
        obj.insert(key.to_string(), json!(next));
    }
}

fn build_snapshot(events: &[PersistedServerEvent]) -> AssessmentSnapshot {
    let mut snapshot = AssessmentSnapshot::default();
    for event in events {
        match event.event_type.as_str() {
            "assessment.started" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let mut run = run_entry(
                        &run_id,
                        string_field(&event.payload, &["swarm"]).as_deref().unwrap_or("rtd"),
                        "running",
                        string_field(&event.payload, &["started_at", "startedAt"])
                            .as_deref()
                            .unwrap_or(&event.ts.to_rfc3339()),
                    );
                    if let Some(scope) = event.payload.get("scope").cloned() {
                        insert_field(&mut run, "scope", scope);
                    }
                    if let Some(snaps) = event.payload.get("connector_snapshots").cloned() {
                        insert_field(&mut run, "connector_snapshots", snaps);
                    }
                    insert_meta(&mut run, &event.payload);
                    if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                        insert_field(&mut run, "sweep_id", json!(sweep_id.clone()));
                        attach_run_to_sweep(&mut snapshot, &sweep_id, &run_id);
                    }
                    snapshot.runs.insert(run_id, run);
                    *snapshot.run_event_counts.entry(
                        string_field(&event.payload, &["run_id", "runId"]).unwrap_or_default(),
                    )
                    .or_default() += 1;
                }
            }
            "assessment.progress" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let run = snapshot
                        .runs
                        .entry(run_id.clone())
                        .or_insert_with(|| run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = run.as_object_mut() {
                        let progress = obj.entry("progress").or_insert_with(|| json!({}));
                        if let Some(progress_obj) = progress.as_object_mut() {
                            for key in ["completed", "total", "current", "phase", "reason", "pass", "max_passes", "elapsed_ms"] {
                                if let Some(value) = event.payload.get(key).cloned() {
                                    progress_obj.insert(key.to_string(), value);
                                }
                            }
                        }
                        insert_meta(run, &event.payload);
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.candidate_received" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let run = snapshot
                        .runs
                        .entry(run_id.clone())
                        .or_insert_with(|| run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = run.as_object_mut() {
                        let validation = obj.entry("validation").or_insert_with(|| {
                            json!({
                                "received": 0,
                                "rejected": 0,
                                "rejection_reasons": {},
                            })
                        });
                        if let Some(v) = validation.as_object_mut() {
                            let received = v.get("received").and_then(Value::as_u64).unwrap_or(0)
                                + event.payload
                                    .get("candidate_count")
                                    .and_then(Value::as_u64)
                                    .unwrap_or(1);
                            v.insert("received".into(), json!(received));
                        }
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.candidate_rejected" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let run = snapshot
                        .runs
                        .entry(run_id.clone())
                        .or_insert_with(|| run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = run.as_object_mut() {
                        let validation = obj.entry("validation").or_insert_with(|| {
                            json!({
                                "received": 0,
                                "rejected": 0,
                                "rejection_reasons": {},
                            })
                        });
                        if let Some(v) = validation.as_object_mut() {
                            let rejected = v.get("rejected").and_then(Value::as_u64).unwrap_or(0) + 1;
                            v.insert("rejected".into(), json!(rejected));
                            let reason = string_field(&event.payload, &["reason", "summary"])
                                .unwrap_or_else(|| "unknown".to_string());
                            let reasons = v
                                .entry("rejection_reasons")
                                .or_insert_with(|| json!({}));
                            if let Some(reason_obj) = reasons.as_object_mut() {
                                let count = reason_obj
                                    .get(&reason)
                                    .and_then(Value::as_u64)
                                    .unwrap_or(0)
                                    .saturating_add(1);
                                reason_obj.insert(reason, json!(count));
                            }
                        }
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.evidence_attached" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    snapshot
                        .evidence_by_run
                        .entry(run_id.clone())
                        .or_default()
                        .push(event.payload.clone());
                    if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                        attach_run_to_sweep(&mut snapshot, &sweep_id, &run_id);
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.finding_added" | "assessment.finding" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    snapshot
                        .findings_by_run
                        .entry(run_id.clone())
                        .or_default()
                        .push(event.payload.clone());
                    if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                        attach_run_to_sweep(&mut snapshot, &sweep_id, &run_id);
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.completed" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let run = snapshot
                        .runs
                        .entry(run_id.clone())
                        .or_insert_with(|| run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = run.as_object_mut() {
                        obj.insert("status".into(), json!("completed"));
                        obj.insert(
                            "finished_at".into(),
                            json!(event.ts.to_rfc3339()),
                        );
                        if let Some(verdict) = event.payload.get("verdict").cloned() {
                            obj.insert("verdict".into(), verdict);
                        }
                        if let Some(score) = event.payload.get("score").cloned() {
                            obj.insert("score".into(), score);
                        }
                        if let Some(counts) = event.payload.get("counts").cloned() {
                            obj.insert("counts".into(), counts);
                        }
                        if let Some(detail) = event.payload.get("verdict_detail").cloned() {
                            obj.insert("verdict_detail".into(), detail);
                        }
                        obj.remove("failure");
                        insert_meta(run, &event.payload);
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.failed" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let status = string_field(&event.payload, &["status"]).unwrap_or_else(|| "failed".to_string());
                    let run = snapshot
                        .runs
                        .entry(run_id.clone())
                        .or_insert_with(|| run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = run.as_object_mut() {
                        obj.insert("status".into(), json!(status));
                        obj.insert("finished_at".into(), json!(event.ts.to_rfc3339()));
                        obj.insert(
                            "failure".into(),
                            json!({
                                "status": status,
                                "reason": string_field(&event.payload, &["reason"]).unwrap_or_else(|| "assessment_failed".to_string()),
                                "detail": event.payload.get("detail").cloned(),
                            }),
                        );
                        if let Some(counts) = event.payload.get("counts").cloned() {
                            obj.insert("counts".into(), counts);
                        }
                        insert_meta(run, &event.payload);
                    }
                    *snapshot.run_event_counts.entry(run_id).or_default() += 1;
                }
            }
            "assessment.sweep.started" => {
                if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                    let families = event
                        .payload
                        .get("families")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    let mut sweep = sweep_entry(
                        &sweep_id,
                        families,
                        "running",
                        string_field(&event.payload, &["started_at", "startedAt"])
                            .as_deref()
                            .unwrap_or(&event.ts.to_rfc3339()),
                    );
                    if let Some(scope) = event.payload.get("scope").cloned() {
                        insert_field(&mut sweep, "scope", scope);
                    }
                    if let Some(total_runs) = event.payload.get("total_runs").cloned() {
                        insert_field(&mut sweep, "total_runs", total_runs);
                    }
                    insert_meta(&mut sweep, &event.payload);
                    snapshot.sweeps.insert(sweep_id, sweep);
                }
            }
            "assessment.sweep.progress" => {
                if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                    let sweep = snapshot
                        .sweeps
                        .entry(sweep_id)
                        .or_insert_with(|| sweep_entry("unknown", vec![], "running", &event.ts.to_rfc3339()));
                    if let Some(obj) = sweep.as_object_mut() {
                        let progress = obj.entry("progress").or_insert_with(|| json!({}));
                        if let Some(progress_obj) = progress.as_object_mut() {
                            for key in ["completed", "total", "current", "phase", "reason", "pass", "max_passes", "elapsed_ms"] {
                                if let Some(value) = event.payload.get(key).cloned() {
                                    progress_obj.insert(key.to_string(), value);
                                }
                            }
                        }
                        insert_meta(sweep, &event.payload);
                    }
                }
            }
            "assessment.sweep.completed" | "assessment.sweep.failed" => {
                if let Some(sweep_id) = string_field(&event.payload, &["sweep_id", "sweepId"]) {
                    let status = string_field(&event.payload, &["status"]).unwrap_or_else(|| {
                        if event.event_type == "assessment.sweep.completed" {
                            "completed".to_string()
                        } else {
                            "failed".to_string()
                        }
                    });
                    let sweep = snapshot
                        .sweeps
                        .entry(sweep_id)
                        .or_insert_with(|| sweep_entry("unknown", vec![], &status, &event.ts.to_rfc3339()));
                    if let Some(obj) = sweep.as_object_mut() {
                        obj.insert("status".into(), json!(status.clone()));
                        obj.insert("finished_at".into(), json!(event.ts.to_rfc3339()));
                        if let Some(verdict) = event.payload.get("verdict").cloned() {
                            obj.insert("verdict".into(), verdict);
                        }
                        if let Some(detail) = event.payload.get("verdict_detail").cloned() {
                            obj.insert("verdict_detail".into(), detail);
                        }
                        if let Some(counts) = event.payload.get("counts").cloned() {
                            obj.insert("counts".into(), counts);
                        }
                        if status == "cancelled" || status == "failed" {
                            obj.insert(
                                "failure".into(),
                                json!({
                                    "status": status,
                                    "reason": string_field(&event.payload, &["reason"]).unwrap_or_else(|| "sweep_failed".to_string()),
                                    "detail": event.payload.get("detail").cloned(),
                                }),
                            );
                        } else {
                            obj.remove("failure");
                        }
                        insert_meta(sweep, &event.payload);
                    }
                }
            }
            _ => {}
        }
    }

    snapshot
}

fn run_entry(run_id: &str, swarm: &str, status: &str, started_at: &str) -> Value {
    json!({
        "id": run_id,
        "swarm": swarm,
        "status": status,
        "started_at": started_at,
        "progress": {
            "completed": 0,
            "total": 0,
        },
        "validation": {
            "received": 0,
            "rejected": 0,
            "rejection_reasons": {},
        },
    })
}

fn sweep_entry(sweep_id: &str, families: Vec<Value>, status: &str, started_at: &str) -> Value {
    json!({
        "id": sweep_id,
        "families": families,
        "status": status,
        "started_at": started_at,
        "progress": {
            "completed": 0,
            "total": 0,
        },
        "run_ids": [],
    })
}

fn insert_meta(target: &mut Value, payload: &Value) {
    if let Some(obj) = target.as_object_mut() {
        for key in [
            "agent_id",
            "agent_kind",
            "agent_role",
            "worker_session_id",
            "sweep_id",
        ] {
            if let Some(value) = payload.get(key).cloned() {
                obj.insert(key.to_string(), value);
            }
        }
    }
}

fn insert_field(target: &mut Value, key: &str, value: Value) {
    if let Some(obj) = target.as_object_mut() {
        obj.insert(key.to_string(), value);
    }
}

fn attach_run_to_sweep(snapshot: &mut AssessmentSnapshot, sweep_id: &str, run_id: &str) {
    let sweep = snapshot
        .sweeps
        .entry(sweep_id.to_string())
        .or_insert_with(|| sweep_entry(sweep_id, vec![], "running", "1970-01-01T00:00:00Z"));
    if let Some(obj) = sweep.as_object_mut() {
        let run_ids = obj.entry("run_ids").or_insert_with(|| json!([]));
        if let Some(arr) = run_ids.as_array_mut() {
            if !arr.iter().any(|id| id.as_str() == Some(run_id)) {
                arr.push(json!(run_id));
            }
        }
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(key).and_then(Value::as_str) {
            return Some(found.to_string());
        }
    }
    None
}

fn ack_error(ack_of: &str, code: &str, message: impl Into<String>) -> (ServerAck, Vec<ServerEvent>) {
    (
        ServerAck {
            ack_of: ack_of.to_string(),
            ok: false,
            error: Some(ErrorInfo {
                code: code.to_string(),
                message: message.into(),
            }),
        },
        vec![],
    )
}

fn server_event(session_id: &str, event_type: &str, payload: Value) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: session_id.to_string(),
        event_type: event_type.to_string(),
        payload,
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

fn lookup_controller(
    state: &AppStateHandle,
    session_id: &str,
) -> Result<crate::session::SessionHandleRef, ()> {
    state.sessions.get(session_id).ok_or(())
}

fn load_snapshot(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> Result<AssessmentSnapshot, (ServerAck, Vec<ServerEvent>)> {
    let Some(persistence) = state.persistence.as_ref() else {
        return Err(ack_error(
            &cmd.id,
            "persistence.disabled",
            "session persistence is not configured",
        ));
    };
    let events = persistence.load_events(&cmd.session_id, 0).map_err(|err| {
        ack_error(
            &cmd.id,
            "assessment.query_failed",
            format!("failed to load persisted assessment events: {err}"),
        )
    })?;
    Ok(build_snapshot(&events))
}

fn build_evidence_preview(
    session_id: &str,
    state: &AppStateHandle,
    uri: Option<&str>,
    locator: Option<&Value>,
    label: Option<&str>,
) -> Result<String, String> {
    let Some(uri) = uri else {
        return Err("missing evidence uri".to_string());
    };
    let path = strip_file_uri(uri);
    let project_root = state
        .sessions
        .get(session_id)
        .map(|handle| handle.project_root.clone())
        .unwrap_or_default();
    let resolved = if path.is_absolute() {
        path
    } else {
        project_root.join(path)
    };
    let contents = fs::read_to_string(&resolved)
        .map_err(|err| format!("failed to read evidence file {}: {err}", resolved.display()))?;
    let lines: Vec<&str> = contents.lines().collect();
    let mut line_no = locator
        .and_then(|loc| loc.get("line").and_then(Value::as_u64))
        .map(|line| line as usize)
        .unwrap_or(1);
    let line_range = locator.and_then(|loc| {
        loc.get("line_range").and_then(Value::as_array).and_then(|arr| {
            let start = arr.first().and_then(Value::as_u64)?;
            let end = arr.get(1).and_then(Value::as_u64)?;
            Some((start as usize, end as usize))
        })
    });
    if let Some((start, end)) = line_range {
        let start = start.max(1);
        let end = end.max(start);
        let mut out = String::new();
        for idx in start..=end.min(lines.len()) {
            if let Some(line) = lines.get(idx - 1) {
                out.push_str(&format!("{idx:>4} | {line}\n"));
            }
        }
        if out.is_empty() {
            return Err("evidence line range out of bounds".to_string());
        }
        return Ok(format!(
            "{}\n{}\n{}",
            label.unwrap_or("evidence preview"),
            resolved.display(),
            out.trim_end()
        ));
    }

    line_no = line_no.max(1);
    if line_no > lines.len() {
        return Err("evidence line out of bounds".to_string());
    }
    let start = line_no.saturating_sub(2).max(1);
    let end = (line_no + 2).min(lines.len());
    let mut out = String::new();
    for idx in start..=end {
        if let Some(line) = lines.get(idx - 1) {
            out.push_str(&format!("{idx:>4} | {line}\n"));
        }
    }
    Ok(format!(
        "{}\n{}\n{}",
        label.unwrap_or("evidence preview"),
        resolved.display(),
        out.trim_end()
    ))
}

fn strip_file_uri(uri: &str) -> PathBuf {
    Path::new(uri.strip_prefix("file://").unwrap_or(uri)).to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::persistence::PersistedServerEvent;
    use chrono::{DateTime, Utc};
    use serde_json::json;

    fn persisted(seq: u64, ts: &str, event_type: &str, payload: Value) -> PersistedServerEvent {
        PersistedServerEvent {
            seq,
            event_type: event_type.to_string(),
            payload,
            ts: DateTime::parse_from_rfc3339(ts)
                .expect("valid timestamp")
                .with_timezone(&Utc),
            redaction: Default::default(),
        }
    }

    #[test]
    fn build_snapshot_tracks_sweeps_runs_and_findings() {
        let events = vec![
            persisted(
                1,
                "2026-01-01T00:00:00Z",
                "assessment.sweep.started",
                json!({
                    "sweep_id": "sweep_01",
                    "families": ["rtd", "security"],
                    "status": "running",
                    "started_at": "2026-01-01T00:00:00Z",
                    "total_runs": 2,
                }),
            ),
            persisted(
                2,
                "2026-01-01T00:00:01Z",
                "assessment.started",
                json!({
                    "run_id": "run_01",
                    "swarm": "rtd",
                    "started_at": "2026-01-01T00:00:01Z",
                    "sweep_id": "sweep_01",
                }),
            ),
            persisted(
                3,
                "2026-01-01T00:00:02Z",
                "assessment.finding_added",
                json!({
                    "finding_id": "finding_01",
                    "identity_hash": "hash_01",
                    "run_id": "run_01",
                    "category": "technical",
                    "subject": "src/app.ts",
                    "check": "check",
                    "severity": "high",
                    "confidence": 0.9,
                    "title": "Finding 1",
                    "summary": "Summary",
                    "evidence_ids": ["evidence_01"],
                }),
            ),
            persisted(
                4,
                "2026-01-01T00:00:03Z",
                "assessment.completed",
                json!({
                    "run_id": "run_01",
                    "verdict": "warn",
                    "score": {
                        "technical": 0.8,
                        "product": 0.5,
                        "ux": 0.3,
                        "release": 0.2,
                        "ops": 0.1,
                    },
                    "counts": {
                        "received": 1,
                        "accepted": 1,
                        "rejected": 0,
                        "findings": 1,
                    },
                }),
            ),
            persisted(
                5,
                "2026-01-01T00:00:04Z",
                "assessment.sweep.completed",
                json!({
                    "sweep_id": "sweep_01",
                    "status": "completed",
                    "completed": 1,
                    "total": 2,
                    "verdict": "warn",
                    "counts": {
                        "completed": 1,
                        "total": 2,
                    },
                }),
            ),
        ];

        let snapshot = build_snapshot(&events);
        let run = snapshot.runs.get("run_01").expect("run in snapshot");
        let sweep = snapshot.sweeps.get("sweep_01").expect("sweep in snapshot");

        assert_eq!(run.get("status").and_then(Value::as_str), Some("completed"));
        assert_eq!(run.get("verdict").and_then(Value::as_str), Some("warn"));
        assert_eq!(sweep.get("status").and_then(Value::as_str), Some("completed"));
        assert_eq!(sweep.get("verdict").and_then(Value::as_str), Some("warn"));
        assert_eq!(
            sweep
                .get("run_ids")
                .and_then(Value::as_array)
                .and_then(|runs| runs.first())
                .and_then(Value::as_str),
            Some("run_01"),
        );
        assert_eq!(
            snapshot
                .findings_by_run
                .get("run_01")
                .and_then(|findings| findings.first())
                .and_then(|finding| finding.get("finding_id"))
                .and_then(Value::as_str),
            Some("finding_01"),
        );
    }

    #[test]
    fn compute_diff_classifies_run_changes() {
        let prev = vec![json!({
            "identity_hash": "hash_prev",
            "severity": "low",
        })];
        let next = vec![
            json!({
                "identity_hash": "hash_prev",
                "severity": "high",
            }),
            json!({
                "identity_hash": "hash_new",
                "severity": "medium",
            }),
        ];

        let diff = compute_diff(&prev, &next);
        assert_eq!(diff["counts"]["regressed"].as_u64(), Some(1));
        assert_eq!(diff["counts"]["new"].as_u64(), Some(1));
        assert_eq!(diff["entries"].as_array().map(|entries| entries.len()), Some(2));
    }
}
