use crate::server::AppStateHandle;
use crate::session::persistence::{PersistedServerEvent, SessionHistoryFilter};
use crate::storage::{AssessmentIndex, AssessmentIndexStatus};
use crate::translator::emit_session_event_live;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::warn;

/// Pull the optional shared `AssessmentIndex` handle off the bridge state.
/// Returning `None` means the bridge booted without a SQLite cache (e.g.
/// because opening `assessment_index.db` failed) — every dispatcher must
/// gracefully fall back to the JSONL event-log path in that case.
fn index_handle(state: &AppStateHandle) -> Option<Arc<AssessmentIndex>> {
    state.assessment_index.clone()
}

#[derive(Default)]
struct AssessmentSnapshot {
    runs: HashMap<String, Value>,
    sweeps: HashMap<String, Value>,
    findings_by_run: HashMap<String, Vec<Value>>,
    evidence_by_run: HashMap<String, Vec<Value>>,
    run_event_counts: HashMap<String, usize>,
}

#[derive(Debug)]
struct CanonicalAssessmentReplay {
    events: Vec<PersistedServerEvent>,
    status: AssessmentIndexStatus,
    sessions_processed: usize,
}

fn lag_bucket(live: &AssessmentIndexStatus, canonical: &AssessmentIndexStatus) -> &'static str {
    let delta = live.runs.abs_diff(canonical.runs)
        + live.findings.abs_diff(canonical.findings)
        + live.sweeps.abs_diff(canonical.sweeps);
    match delta {
        0 => "none",
        1..=5 => "low",
        6..=25 => "medium",
        _ => "high",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssessmentQuerySource {
    Index,
    EventLog,
}

impl AssessmentQuerySource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Index => "index",
            Self::EventLog => "event_log",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssessmentQueryFallbackReason {
    Missing,
    Incomplete,
    Error,
}

impl AssessmentQueryFallbackReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "index_missing",
            Self::Incomplete => "index_incomplete",
            Self::Error => "index_error",
        }
    }
}

fn annotate_query_provenance(
    payload: &mut Value,
    query_source: AssessmentQuerySource,
    fallback_reason: Option<AssessmentQueryFallbackReason>,
) {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("query_source".into(), json!(query_source.as_str()));
        obj.insert(
            "fallback_reason".into(),
            match fallback_reason {
                Some(reason) => json!(reason.as_str()),
                None => Value::Null,
            },
        );
        // Back-compat shims for older clients still looking at the legacy
        // provenance markers. The new fields above are authoritative.
        obj.insert("source".into(), json!(query_source.as_str()));
        obj.insert(
            "index_complete".into(),
            json!(matches!(query_source, AssessmentQuerySource::Index)),
        );
    }
}

fn load_canonical_assessment_replay(
    state: &AppStateHandle,
) -> Result<CanonicalAssessmentReplay, String> {
    let Some(persistence) = state.persistence.as_ref() else {
        return Err("session persistence is not configured".to_string());
    };

    let sessions = persistence
        .list(&SessionHistoryFilter::default())
        .map_err(|err| format!("failed to list persisted sessions: {err}"))?;

    let mut events = Vec::new();
    let mut sessions_processed = 0usize;
    for meta in sessions {
        let mut session_events =
            persistence
                .load_events(&meta.vac_session_id, 0)
                .map_err(|err| {
                    format!(
                        "failed to load persisted assessment events for {}: {err}",
                        meta.vac_session_id
                    )
                })?;
        sessions_processed += 1;
        events.append(&mut session_events);
    }

    events.sort_by(|a, b| {
        a.ts.cmp(&b.ts)
            .then(a.seq.cmp(&b.seq))
            .then(a.event_type.cmp(&b.event_type))
    });

    let temp_index = AssessmentIndex::open_in_memory()
        .map_err(|err| format!("failed to open temporary assessment index: {err}"))?;
    let status = temp_index
        .rebuild_from_events(&events)
        .map_err(|err| format!("failed to build canonical assessment status: {err}"))?;

    Ok(CanonicalAssessmentReplay {
        events,
        status,
        sessions_processed,
    })
}

pub async fn dispatch_assessment_index_status(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(index) = index_handle(state) else {
        return ack_error(
            &cmd.id,
            "assessment.index_disabled",
            "assessment index is not configured",
        );
    };

    let live_status = match index.status() {
        Ok(status) => status,
        Err(err) => {
            return ack_error(
                &cmd.id,
                "assessment.index_status_failed",
                format!("failed to read assessment index status: {err}"),
            );
        }
    };

    let replay = match load_canonical_assessment_replay(state) {
        Ok(replay) => replay,
        Err(err) => {
            return ack_error(
                &cmd.id,
                "assessment.index_status_failed",
                format!("failed to load canonical assessment replay: {err}"),
            );
        }
    };

    let payload = json!({
        "scope": "assessment_index",
        "ok": true,
        "live": live_status,
        "canonical": replay.status,
        "lag_bucket": lag_bucket(&live_status, &replay.status),
        "sessions_processed": replay.sessions_processed,
        "canonical_events": replay.events.len(),
        "index_complete": true,
    });

    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        vec![server_event(
            &cmd.session_id,
            "assessment.index.status",
            payload,
        )],
    )
}

pub async fn dispatch_assessment_index_rebuild(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let Some(index) = index_handle(state) else {
        return ack_error(
            &cmd.id,
            "assessment.index_disabled",
            "assessment index is not configured",
        );
    };

    let started = server_event(
        &cmd.session_id,
        "assessment.index.rebuild_started",
        json!({
            "scope": "assessment_index",
            "ok": true,
        }),
    );

    let mut events = vec![started];

    let replay = match load_canonical_assessment_replay(state) {
        Ok(replay) => replay,
        Err(err) => {
            warn!(error = %err, "assessment index rebuild canonical replay failed");
            events.push(server_event(
                &cmd.session_id,
                "assessment.index.rebuild_failed",
                json!({
                    "scope": "assessment_index",
                    "ok": false,
                    "phase": "canonical_replay",
                    "reason": err,
                }),
            ));
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "assessment.index_rebuild_failed".into(),
                        message: "failed to rebuild assessment index from canonical events".into(),
                    }),
                },
                events,
            );
        }
    };

    events.push(server_event(
        &cmd.session_id,
        "assessment.index.rebuild_progress",
        json!({
            "scope": "assessment_index",
            "ok": true,
            "phase": "canonical_replay_loaded",
            "sessions_processed": replay.sessions_processed,
            "canonical_events": replay.events.len(),
        }),
    ));

    let rebuild_status = match index.rebuild_from_events(&replay.events) {
        Ok(status) => status,
        Err(err) => {
            warn!(error = %err, "assessment index rebuild failed");
            events.push(server_event(
                &cmd.session_id,
                "assessment.index.rebuild_failed",
                json!({
                    "scope": "assessment_index",
                    "ok": false,
                    "phase": "rebuild",
                    "reason": err.to_string(),
                    "sessions_processed": replay.sessions_processed,
                    "canonical_events": replay.events.len(),
                }),
            ));
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "assessment.index_rebuild_failed".into(),
                        message: "failed to rebuild assessment index from canonical events".into(),
                    }),
                },
                events,
            );
        }
    };

    events.push(server_event(
        &cmd.session_id,
        "assessment.index.rebuilt",
        json!({
            "scope": "assessment_index",
            "ok": true,
            "sessions_processed": replay.sessions_processed,
            "canonical_events": replay.events.len(),
            "status": rebuild_status,
        }),
    ));

    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        events,
    )
}

pub async fn dispatch_assessment_list_runs(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    // Fast-path: if the SQLite index is available and has rows for this
    // session, serve list_runs entirely from it. The index does not store
    // evidence/event-counts, but list_runs only needs run / sweep summaries
    // (id, swarm, status, started_at, completed_at, verdict) — all of which
    // are columns on the row, so we can mark the response as
    // `index_complete: true` here.
    let mut fallback_reason = AssessmentQueryFallbackReason::Missing;
    if let Some(index) = index_handle(state) {
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
        match try_serve_list_runs_from_index(
            cmd,
            state,
            index.as_ref(),
            swarm_filter.as_deref(),
            limit,
        )
        .await
        {
            IndexAttempt::Hit => {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: true,
                        error: None,
                    },
                    vec![],
                );
            }
            IndexAttempt::Miss(reason) => {
                fallback_reason = reason;
                // fall through to event_log path with normalized
                // provenance metadata on the response.
            }
        }
    }

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
        .or_else(|| {
            runs.last()
                .and_then(|run| run.get("id").and_then(Value::as_str))
                .map(str::to_string)
        });

    let active_sweep_id = sweeps
        .iter()
        .rev()
        .find(|sweep| sweep.get("status").and_then(Value::as_str) == Some("running"))
        .and_then(|sweep| sweep.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| {
            sweeps
                .last()
                .and_then(|sweep| sweep.get("id").and_then(Value::as_str))
                .map(str::to_string)
        });

    let mut payload = json!({
        "swarm": swarm_filter,
        "limit": limit,
        "active_run_id": active_run_id,
        "active_sweep_id": active_sweep_id,
        "runs": runs,
        "sweeps": sweeps,
    });
    annotate_query_provenance(
        &mut payload,
        AssessmentQuerySource::EventLog,
        Some(fallback_reason),
    );

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        emit_session_event_live(
            &controller,
            server_event(&cmd.session_id, "assessment.runs_listed", payload),
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

    let prev = snapshot
        .findings_by_run
        .get(base_run_id)
        .cloned()
        .unwrap_or_default();
    let next_findings = snapshot
        .findings_by_run
        .get(next_run_id)
        .cloned()
        .unwrap_or_default();
    let diff = compute_diff(&prev, &next_findings);
    let counts = diff.get("counts").cloned().unwrap_or_else(|| json!({}));
    let entries = diff.get("entries").cloned().unwrap_or_else(|| json!([]));
    let fallback_reason = if index_handle(state).is_some() {
        AssessmentQueryFallbackReason::Incomplete
    } else {
        AssessmentQueryFallbackReason::Missing
    };

    let mut base = base.clone();
    annotate_query_provenance(
        &mut base,
        AssessmentQuerySource::EventLog,
        Some(fallback_reason),
    );
    let mut next = next.clone();
    annotate_query_provenance(
        &mut next,
        AssessmentQuerySource::EventLog,
        Some(fallback_reason),
    );

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        let mut payload = json!({
            "base_run_id": base_run_id,
            "next_run_id": next_run_id,
            "base_run": base,
            "next_run": next,
            "counts": counts,
            "entries": entries,
        });
        annotate_query_provenance(
            &mut payload,
            AssessmentQuerySource::EventLog,
            Some(fallback_reason),
        );
        emit_session_event_live(
            &controller,
            server_event(&cmd.session_id, "assessment.diffed", payload),
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

    let preview_result = build_evidence_preview(
        &cmd.session_id,
        state,
        evidence.get("uri").and_then(Value::as_str),
        evidence.get("locator"),
        evidence.get("label").and_then(Value::as_str),
    );

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        let evidence_source = evidence
            .get("connector")
            .or_else(|| evidence.get("source"))
            .and_then(Value::as_str)
            .unwrap_or("filesystem");
        let evidence_kind = evidence
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("file");
        let event = match preview_result {
            Ok(preview) => server_event(
                &cmd.session_id,
                "assessment.evidence_preview",
                json!({
                    "source": "event_log",
                    "index_complete": false,
                    "fallback_reason": "evidence_not_indexed",
                    "id": evidence_id,
                    "preview": preview,
                    "evidence_source": evidence_source,
                    "kind": evidence_kind,
                    "preview_available": true,
                }),
            ),
            Err(reason) => {
                let failure_reason = classify_evidence_preview_failure(&reason);
                server_event(
                    &cmd.session_id,
                    "assessment.evidence_preview_failed",
                    json!({
                        "source": "event_log",
                        "index_complete": false,
                        "fallback_reason": "evidence_not_indexed",
                        "id": evidence_id,
                        "reason": failure_reason,
                        "message": reason,
                        "evidence_source": evidence_source,
                        "kind": evidence_kind,
                        "preview_available": false,
                    }),
                )
            }
        };
        emit_session_event_live(&controller, event).await;
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
    let findings = snapshot
        .findings_by_run
        .get(run_id)
        .cloned()
        .unwrap_or_default();
    let evidence = snapshot
        .evidence_by_run
        .get(run_id)
        .cloned()
        .unwrap_or_default();
    let sweep = run
        .get("sweep_id")
        .and_then(Value::as_str)
        .and_then(|id| snapshot.sweeps.get(id))
        .cloned();
    let event_count = snapshot.run_event_counts.get(run_id).copied().unwrap_or(0);

    let fallback_reason = if index_handle(state).is_some() {
        AssessmentQueryFallbackReason::Incomplete
    } else {
        AssessmentQueryFallbackReason::Missing
    };

    let mut run = run;
    annotate_query_provenance(
        &mut run,
        AssessmentQuerySource::EventLog,
        Some(fallback_reason),
    );

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        // Reports/replays fall back to the JSONL event log because the
        // SQLite index does not store evidence rows or per-run event counts.
        let mut payload = json!({
            "run_id": run_id,
            "run": run,
            "findings": findings,
            "evidence": evidence,
            "sweep": sweep,
            "replayed_events": event_count,
        });
        annotate_query_provenance(
            &mut payload,
            AssessmentQuerySource::EventLog,
            Some(fallback_reason),
        );
        emit_session_event_live(
            &controller,
            server_event(&cmd.session_id, event_type, payload.clone()),
        )
        .await;
        if include_report_mark {
            emit_session_event_live(
                &controller,
                server_event(&cmd.session_id, "assessment.report_fetched", payload),
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
        let next = obj
            .get(key)
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .saturating_add(1);
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
                        string_field(&event.payload, &["swarm"])
                            .as_deref()
                            .unwrap_or("rtd"),
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
                    *snapshot
                        .run_event_counts
                        .entry(
                            string_field(&event.payload, &["run_id", "runId"]).unwrap_or_default(),
                        )
                        .or_default() += 1;
                }
            }
            "assessment.progress" => {
                if let Some(run_id) = string_field(&event.payload, &["run_id", "runId"]) {
                    let run = snapshot.runs.entry(run_id.clone()).or_insert_with(|| {
                        run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339())
                    });
                    if let Some(obj) = run.as_object_mut() {
                        let progress = obj.entry("progress").or_insert_with(|| json!({}));
                        if let Some(progress_obj) = progress.as_object_mut() {
                            for key in [
                                "completed",
                                "total",
                                "current",
                                "phase",
                                "reason",
                                "pass",
                                "max_passes",
                                "elapsed_ms",
                            ] {
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
                    let run = snapshot.runs.entry(run_id.clone()).or_insert_with(|| {
                        run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339())
                    });
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
                                + event
                                    .payload
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
                    let run = snapshot.runs.entry(run_id.clone()).or_insert_with(|| {
                        run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339())
                    });
                    if let Some(obj) = run.as_object_mut() {
                        let validation = obj.entry("validation").or_insert_with(|| {
                            json!({
                                "received": 0,
                                "rejected": 0,
                                "rejection_reasons": {},
                            })
                        });
                        if let Some(v) = validation.as_object_mut() {
                            let rejected =
                                v.get("rejected").and_then(Value::as_u64).unwrap_or(0) + 1;
                            v.insert("rejected".into(), json!(rejected));
                            let reason = string_field(&event.payload, &["reason", "summary"])
                                .unwrap_or_else(|| "unknown".to_string());
                            let reasons = v.entry("rejection_reasons").or_insert_with(|| json!({}));
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
                    let run = snapshot.runs.entry(run_id.clone()).or_insert_with(|| {
                        run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339())
                    });
                    if let Some(obj) = run.as_object_mut() {
                        obj.insert("status".into(), json!("completed"));
                        obj.insert("finished_at".into(), json!(event.ts.to_rfc3339()));
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
                    let status = string_field(&event.payload, &["status"])
                        .unwrap_or_else(|| "failed".to_string());
                    let run = snapshot.runs.entry(run_id.clone()).or_insert_with(|| {
                        run_entry(&run_id, "rtd", "running", &event.ts.to_rfc3339())
                    });
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
                    let sweep = snapshot.sweeps.entry(sweep_id).or_insert_with(|| {
                        sweep_entry("unknown", vec![], "running", &event.ts.to_rfc3339())
                    });
                    if let Some(obj) = sweep.as_object_mut() {
                        let progress = obj.entry("progress").or_insert_with(|| json!({}));
                        if let Some(progress_obj) = progress.as_object_mut() {
                            for key in [
                                "completed",
                                "total",
                                "current",
                                "phase",
                                "reason",
                                "pass",
                                "max_passes",
                                "elapsed_ms",
                            ] {
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
                    let sweep = snapshot.sweeps.entry(sweep_id).or_insert_with(|| {
                        sweep_entry("unknown", vec![], &status, &event.ts.to_rfc3339())
                    });
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

fn ack_error(
    ack_of: &str,
    code: &str,
    message: impl Into<String>,
) -> (ServerAck, Vec<ServerEvent>) {
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

fn classify_evidence_preview_failure(reason: &str) -> &'static str {
    let lower = reason.to_ascii_lowercase();
    if lower.contains("permission denied") {
        "permission_denied"
    } else if lower.contains("not found")
        || lower.contains("no such file")
        || lower.contains("failed to read evidence file")
    {
        "not_found"
    } else if lower.contains("missing evidence uri") || lower.contains("unsupported") {
        "unsupported_source"
    } else if lower.contains("connector") {
        "connector_unavailable"
    } else {
        "preview_failed"
    }
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
        loc.get("line_range")
            .and_then(Value::as_array)
            .and_then(|arr| {
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

/// Outcome of an attempt to serve a query from the SQLite index.
#[derive(Debug)]
enum IndexAttempt {
    /// Index served the response and the dispatcher has already emitted
    /// the corresponding `assessment.*` event. The dispatcher should
    /// short-circuit and ack-ok.
    Hit,
    /// Index could not (or chose not to) serve the response. The string
    /// argument carries a short, low-cardinality reason suitable for the
    /// `fallback_reason` field on the JSONL response.
    #[allow(dead_code)]
    Miss(AssessmentQueryFallbackReason),
}

/// Try to answer `assessment.runs_listed` entirely from the SQLite index.
/// Emits the response event and returns `IndexAttempt::Hit` on success.
/// Returns `IndexAttempt::Miss(reason)` when the dispatcher must fall back
/// to the JSONL event-log scan.
async fn try_serve_list_runs_from_index(
    cmd: &ClientCommand,
    state: &AppStateHandle,
    index: &AssessmentIndex,
    swarm_filter: Option<&str>,
    limit: Option<usize>,
) -> IndexAttempt {
    let effective_limit = limit.unwrap_or(0);
    let rows = match index.list_runs(Some(&cmd.session_id), swarm_filter, effective_limit) {
        Ok(rows) => rows,
        Err(_) => return IndexAttempt::Miss(AssessmentQueryFallbackReason::Error),
    };
    let sweep_rows = match index.list_sweeps(Some(&cmd.session_id), effective_limit) {
        Ok(rows) => rows,
        Err(_) => return IndexAttempt::Miss(AssessmentQueryFallbackReason::Error),
    };
    if rows.is_empty() && sweep_rows.is_empty() {
        return IndexAttempt::Miss(AssessmentQueryFallbackReason::Incomplete);
    }

    // The `list_runs` query orders newest-first; the existing event_log
    // path orders oldest-first. Re-sort to match so the frontend doesn't
    // need to know which path served the response.
    let mut runs: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut entry = json!({
                "id": row.run_id,
                "swarm": row.swarm,
                "status": row.status,
                "started_at": row.started_at,
            });
            if let Some(ref completed_at) = row.completed_at {
                entry["completed_at"] = json!(completed_at);
                entry["finished_at"] = json!(completed_at);
            }
            if let Some(ref verdict) = row.verdict {
                entry["verdict"] = json!(verdict);
            }
            // Preserve any extra fields the writer mirrored into payload_json
            // (sweep_id, started_by, depth, etc.). Existing columns win on
            // conflict so a fresh terminal status cannot be undone by a stale
            // payload_json from an out-of-order progress event.
            if let Ok(payload) = serde_json::from_str::<Value>(&row.payload_json) {
                if let (Value::Object(ref mut map), Value::Object(extras)) = (&mut entry, payload) {
                    for (k, v) in extras {
                        map.entry(k).or_insert(v);
                    }
                }
            }
            entry
        })
        .collect();
    runs.sort_by(|a, b| {
        let a_started = a.get("started_at").and_then(Value::as_str).unwrap_or("");
        let b_started = b.get("started_at").and_then(Value::as_str).unwrap_or("");
        a_started.cmp(b_started)
    });

    for run in &mut runs {
        annotate_query_provenance(run, AssessmentQuerySource::Index, None);
    }

    let mut sweeps: Vec<Value> = sweep_rows
        .iter()
        .filter_map(|row| {
            let families: Vec<Value> = row
                .families_csv
                .split(',')
                .map(str::trim)
                .filter(|family| !family.is_empty())
                .map(|family| json!(family))
                .collect();
            if let Some(filter) = swarm_filter {
                if !families
                    .iter()
                    .any(|family| family.as_str() == Some(filter))
                {
                    return None;
                }
            }
            let mut entry = json!({
                "id": row.sweep_id,
                "families": families,
                "status": row.status,
                "started_at": row.started_at,
                "run_ids": [],
            });
            if let Some(ref completed_at) = row.completed_at {
                entry["completed_at"] = json!(completed_at);
                entry["finished_at"] = json!(completed_at);
            }
            if let Ok(payload) = serde_json::from_str::<Value>(&row.payload_json) {
                if let (Value::Object(ref mut map), Value::Object(extras)) = (&mut entry, payload) {
                    for (k, v) in extras {
                        map.entry(k).or_insert(v);
                    }
                }
            }
            Some(entry)
        })
        .collect();
    sweeps.sort_by(|a, b| {
        let a_started = a.get("started_at").and_then(Value::as_str).unwrap_or("");
        let b_started = b.get("started_at").and_then(Value::as_str).unwrap_or("");
        a_started.cmp(b_started)
    });
    for sweep in &mut sweeps {
        annotate_query_provenance(sweep, AssessmentQuerySource::Index, None);
    }

    let active_run_id = runs
        .iter()
        .rev()
        .find(|run| run.get("status").and_then(Value::as_str) == Some("running"))
        .and_then(|run| run.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| {
            runs.last()
                .and_then(|run| run.get("id").and_then(Value::as_str))
                .map(str::to_string)
        });

    let active_sweep_id = sweeps
        .iter()
        .rev()
        .find(|sweep| sweep.get("status").and_then(Value::as_str) == Some("running"))
        .and_then(|sweep| sweep.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| {
            sweeps
                .last()
                .and_then(|sweep| sweep.get("id").and_then(Value::as_str))
                .map(str::to_string)
        });

    let mut payload = json!({
        "swarm": swarm_filter,
        "limit": limit,
        "active_run_id": active_run_id,
        "active_sweep_id": active_sweep_id,
        "runs": runs,
        "sweeps": sweeps,
    });
    annotate_query_provenance(&mut payload, AssessmentQuerySource::Index, None);

    if let Ok(controller) = lookup_controller(state, &cmd.session_id) {
        emit_session_event_live(
            &controller,
            server_event(&cmd.session_id, "assessment.runs_listed", payload),
        )
        .await;
    }
    IndexAttempt::Hit
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::AuditFacility;
    use crate::auth::{AuthState, PairingStore};
    use crate::config::{ConfigSnapshot, SessionResumePolicy};
    use crate::handoff::HandoffService;
    use crate::server::AppState;
    use crate::session::handle::test_handle;
    use crate::session::persistence::PersistedServerEvent;
    use crate::session::persistence::{
        FilePersistence, PersistedSessionMeta, PersistedSessionStatus, PersistenceHealth,
        PersistenceNativeResume, PersistenceResult, PersistenceVersion, SessionPersistence,
        SharedPersistence,
    };
    use crate::session::SessionRegistry;
    use crate::storage::{
        AssessmentFindingRow, AssessmentIndex, AssessmentRunRow, AssessmentSweepRow,
    };
    use chrono::{DateTime, Utc};
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Instant;
    use tempfile::TempDir;
    use tokio::sync::RwLock;

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

    fn parse_utc(ts: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(ts)
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }

    fn session_meta(session_id: &str, project_root: &Path) -> PersistedSessionMeta {
        let now = Utc::now();
        PersistedSessionMeta {
            version: PersistenceVersion::default(),
            vac_session_id: session_id.to_string(),
            agent_session_id: Some(format!("agent-{session_id}")),
            agent_id: "mock-acp".to_string(),
            agent_kind: "acp".to_string(),
            project_root: project_root.to_path_buf(),
            profile_id: "executor.code@1.0.0".to_string(),
            workflow_id: None,
            created_at: now,
            updated_at: now,
            status: PersistedSessionStatus::Active,
            native_resume: PersistenceNativeResume::default(),
            mcp_servers: vec![],
            agent_capabilities: json!({"loadSession": true}),
            profile_class: Some("executor".to_string()),
        }
    }

    fn make_file_persistence(root: &TempDir) -> SharedPersistence {
        let sessions_dir = root.path().join("sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        Arc::new(FilePersistence::open(&sessions_dir).expect("open FilePersistence"))
    }

    fn make_state(
        persistence: Option<SharedPersistence>,
        assessment_index: Option<Arc<AssessmentIndex>>,
        root: &TempDir,
    ) -> AppStateHandle {
        let audit_dir = root.path().join("audit");
        std::fs::create_dir_all(&audit_dir).unwrap();
        Arc::new(AppState {
            started_at: Instant::now(),
            sessions: SessionRegistry::new(PathBuf::from("/path/to/mock-engine")),
            auth: AuthState::new_dev(),
            audit: Arc::new(AuditFacility::new(audit_dir)),
            pairing: PairingStore::new(),
            profile_root: PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../packages/protocol/v1/profiles"
            )),
            handoff: Arc::new(HandoffService::new()),
            persistence,
            persistence_health: PersistenceHealth::default(),
            assessment_index,
            resume_policy: Arc::new(SessionResumePolicy::default()),
            config_snapshot: Arc::new(RwLock::new(ConfigSnapshot::default())),
            release_provider: crate::release::ReleaseProvider::default(),
        })
    }

    fn make_cmd(id: &str, session_id: &str, cmd_type: &str) -> ClientCommand {
        ClientCommand {
            id: id.to_string(),
            session_id: session_id.to_string(),
            cmd_type: cmd_type.to_string(),
            payload: json!({}),
            v: 1,
        }
    }

    fn seed_session(
        persistence: &SharedPersistence,
        session_id: &str,
        project_root: &Path,
        events: &[PersistedServerEvent],
    ) {
        persistence
            .save_meta(&session_meta(session_id, project_root))
            .expect("save_meta");
        for event in events {
            persistence
                .append_event(session_id, event)
                .expect("append_event");
        }
    }

    fn seed_live_index(
        index: &AssessmentIndex,
        session_id: &str,
        started_at: &str,
        completed_at: &str,
        finding_emitted_at: &str,
        sweep_started_at: &str,
        sweep_completed_at: &str,
    ) {
        index
            .record_run(&AssessmentRunRow {
                run_id: "run_01".to_string(),
                session_id: session_id.to_string(),
                swarm: "rtd".to_string(),
                status: "completed".to_string(),
                started_at: started_at.to_string(),
                completed_at: Some(completed_at.to_string()),
                verdict: Some("warn".to_string()),
                payload_json: json!({"run_id": "run_01"}).to_string(),
            })
            .expect("record run");
        index
            .record_finding(&AssessmentFindingRow {
                finding_id: "finding_01".to_string(),
                run_id: "run_01".to_string(),
                identity_hash: "hash_01".to_string(),
                severity: "high".to_string(),
                category: "technical".to_string(),
                emitted_at: finding_emitted_at.to_string(),
                payload_json: json!({"finding_id": "finding_01"}).to_string(),
            })
            .expect("record finding");
        index
            .record_sweep(&AssessmentSweepRow {
                sweep_id: "sweep_01".to_string(),
                session_id: session_id.to_string(),
                status: "completed".to_string(),
                started_at: sweep_started_at.to_string(),
                completed_at: Some(sweep_completed_at.to_string()),
                families_csv: "rtd,security".to_string(),
                payload_json: json!({"sweep_id": "sweep_01"}).to_string(),
            })
            .expect("record sweep");
    }

    struct FailingReplayPersistence {
        meta: PersistedSessionMeta,
    }

    impl SessionPersistence for FailingReplayPersistence {
        fn save_meta(&self, _meta: &PersistedSessionMeta) -> PersistenceResult<()> {
            Ok(())
        }

        fn load_meta(
            &self,
            vac_session_id: &str,
        ) -> PersistenceResult<Option<PersistedSessionMeta>> {
            if vac_session_id == self.meta.vac_session_id {
                Ok(Some(self.meta.clone()))
            } else {
                Ok(None)
            }
        }

        fn list(
            &self,
            _filter: &crate::session::persistence::SessionHistoryFilter,
        ) -> PersistenceResult<Vec<PersistedSessionMeta>> {
            Ok(vec![self.meta.clone()])
        }

        fn append_event(
            &self,
            _vac_session_id: &str,
            _event: &PersistedServerEvent,
        ) -> PersistenceResult<()> {
            Ok(())
        }

        fn load_events(
            &self,
            _vac_session_id: &str,
            _limit: usize,
        ) -> PersistenceResult<Vec<PersistedServerEvent>> {
            Err(std::io::Error::other("canonical replay failed").into())
        }

        fn mark_status(
            &self,
            _vac_session_id: &str,
            _status: PersistedSessionStatus,
        ) -> PersistenceResult<()> {
            Ok(())
        }

        fn forget(&self, _vac_session_id: &str) -> PersistenceResult<()> {
            Ok(())
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
        assert_eq!(
            sweep.get("status").and_then(Value::as_str),
            Some("completed")
        );
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
        assert_eq!(
            diff["entries"].as_array().map(|entries| entries.len()),
            Some(2)
        );
    }

    #[tokio::test]
    async fn assessment_index_status_reports_live_and_canonical_counts() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_status";
        let started_at = "2026-01-01T00:00:01Z";
        let finding_emitted_at = "2026-01-01T00:00:02Z";
        let completed_at = "2026-01-01T00:00:03Z";
        let sweep_started_at = "2026-01-01T00:00:00Z";
        let sweep_completed_at = "2026-01-01T00:00:04Z";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    sweep_started_at,
                    "assessment.sweep.started",
                    json!({
                        "sweep_id": "sweep_01",
                        "status": "running",
                        "started_at": sweep_started_at,
                        "families": ["rtd", "security"],
                    }),
                ),
                persisted(
                    2,
                    started_at,
                    "assessment.started",
                    json!({
                        "run_id": "run_01",
                        "swarm": "rtd",
                        "started_at": started_at,
                    }),
                ),
                persisted(
                    3,
                    finding_emitted_at,
                    "assessment.finding_added",
                    json!({
                        "finding_id": "finding_01",
                        "identity_hash": "hash_01",
                        "run_id": "run_01",
                        "category": "technical",
                        "severity": "high",
                        "title": "Finding 1",
                    }),
                ),
                persisted(
                    4,
                    completed_at,
                    "assessment.completed",
                    json!({
                        "run_id": "run_01",
                        "verdict": "warn",
                    }),
                ),
                persisted(
                    5,
                    sweep_completed_at,
                    "assessment.sweep.completed",
                    json!({
                        "sweep_id": "sweep_01",
                        "status": "completed",
                        "verdict": "warn",
                    }),
                ),
            ],
        );
        seed_live_index(
            &index,
            session_id,
            started_at,
            completed_at,
            finding_emitted_at,
            sweep_started_at,
            sweep_completed_at,
        );

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let cmd = make_cmd("cmd_index_status", session_id, "assessment.index.status");

        let (ack, events) = dispatch_assessment_index_status(&cmd, &state).await;
        assert!(ack.ok);
        assert!(ack.error.is_none());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "assessment.index.status");
        assert_eq!(events[0].payload["ok"], json!(true));
        assert_eq!(events[0].payload["live"]["runs"], json!(1));
        assert_eq!(events[0].payload["live"]["findings"], json!(1));
        assert_eq!(events[0].payload["live"]["sweeps"], json!(1));
        assert_eq!(events[0].payload["canonical"]["runs"], json!(1));
        assert_eq!(events[0].payload["canonical"]["findings"], json!(1));
        assert_eq!(events[0].payload["canonical"]["sweeps"], json!(1));
        assert_eq!(events[0].payload["lag_bucket"], json!("none"));
        assert_eq!(events[0].payload["sessions_processed"], json!(1));
        let expected_last_indexed_at = parse_utc(sweep_completed_at);
        assert_eq!(
            parse_utc(
                events[0].payload["live"]["last_indexed_at"]
                    .as_str()
                    .expect("live last_indexed_at"),
            ),
            expected_last_indexed_at
        );
        assert_eq!(
            parse_utc(
                events[0].payload["canonical"]["last_indexed_at"]
                    .as_str()
                    .expect("canonical last_indexed_at"),
            ),
            expected_last_indexed_at
        );
    }

    #[tokio::test]
    async fn assessment_list_runs_index_path_emits_query_source_index() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_list_index";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    "2026-01-01T00:00:00Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_index",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:00Z",
                    }),
                ),
                persisted(
                    2,
                    "2026-01-01T00:00:01Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_index",
                        "verdict": "warn",
                    }),
                ),
            ],
        );
        seed_live_index(
            &index,
            session_id,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:01Z",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:01Z",
        );

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let (handle, mut rx) = test_handle(session_id);
        state.sessions.insert_for_test(session_id, handle);
        let mut cmd = make_cmd("cmd_list_index", session_id, "assessment.list_runs");
        cmd.payload = json!({ "limit": 50 });

        let (ack, events) = dispatch_assessment_list_runs(&cmd, &state).await;
        assert!(ack.ok);
        assert!(events.is_empty());

        let event = rx.recv().await.expect("list runs event");
        let payload = &event.payload;
        assert_eq!(event.event_type, "assessment.runs_listed");
        assert_eq!(payload["query_source"], json!("index"));
        assert_eq!(payload["fallback_reason"], Value::Null);
        assert_eq!(payload["source"], json!("index"));
        assert_eq!(payload["index_complete"], json!(true));
        assert_eq!(payload["runs"][0]["query_source"], json!("index"));
        assert_eq!(
            payload["runs"][0]["finished_at"],
            json!("2026-01-01T00:00:01Z")
        );
        assert_eq!(payload["active_sweep_id"], json!("sweep_01"));
        assert_eq!(payload["sweeps"][0]["id"], json!("sweep_01"));
        assert_eq!(payload["sweeps"][0]["query_source"], json!("index"));
    }

    #[tokio::test]
    async fn assessment_list_runs_fallback_path_emits_query_source_event_log() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let session_id = "sess_list_fallback";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    "2026-01-01T00:00:00Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_fallback",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:00Z",
                    }),
                ),
                persisted(
                    2,
                    "2026-01-01T00:00:01Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_fallback",
                        "verdict": "warn",
                    }),
                ),
            ],
        );

        let state = make_state(Some(Arc::clone(&persistence)), None, &tmp);
        let (handle, mut rx) = test_handle(session_id);
        state.sessions.insert_for_test(session_id, handle);
        let mut cmd = make_cmd("cmd_list_fallback", session_id, "assessment.list_runs");
        cmd.payload = json!({ "limit": 50 });

        let (ack, events) = dispatch_assessment_list_runs(&cmd, &state).await;
        assert!(ack.ok);
        assert!(events.is_empty());

        let event = rx.recv().await.expect("list runs event");
        let payload = &event.payload;
        assert_eq!(event.event_type, "assessment.runs_listed");
        assert_eq!(payload["query_source"], json!("event_log"));
        assert_eq!(payload["fallback_reason"], json!("index_missing"));
        assert_eq!(payload["source"], json!("event_log"));
        assert_eq!(payload["index_complete"], json!(false));
    }

    #[tokio::test]
    async fn assessment_fetch_report_emits_query_source_event_log_with_fallback_reason() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_report";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    "2026-01-01T00:00:00Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_report",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:00Z",
                    }),
                ),
                persisted(
                    2,
                    "2026-01-01T00:00:01Z",
                    "assessment.finding_added",
                    json!({
                        "finding_id": "finding_report",
                        "identity_hash": "hash_report",
                        "run_id": "run_report",
                        "category": "technical",
                        "subject": "src/app.ts",
                        "check": "check",
                        "severity": "medium",
                        "confidence": 0.9,
                        "title": "Finding report",
                        "summary": "Summary",
                        "evidence_ids": ["evidence_report"],
                    }),
                ),
                persisted(
                    3,
                    "2026-01-01T00:00:02Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_report",
                        "verdict": "warn",
                    }),
                ),
            ],
        );

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let (handle, mut rx) = test_handle(session_id);
        state.sessions.insert_for_test(session_id, handle);
        let mut cmd = make_cmd("cmd_report", session_id, "assessment.fetch_report");
        cmd.payload = json!({ "run_id": "run_report" });

        let (ack, events) = dispatch_assessment_fetch_report(&cmd, &state).await;
        assert!(ack.ok);
        assert!(events.is_empty());

        let event = rx.recv().await.expect("report event");
        assert_eq!(event.event_type, "assessment.report_fetched");
        assert_eq!(event.payload["query_source"], json!("event_log"));
        assert_eq!(event.payload["fallback_reason"], json!("index_incomplete"));
        assert_eq!(event.payload["run"]["query_source"], json!("event_log"));
        assert_eq!(
            event.payload["run"]["fallback_reason"],
            json!("index_incomplete")
        );
    }

    #[tokio::test]
    async fn assessment_replay_emits_query_source_event_log_and_report_mark() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_replay";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    "2026-01-01T00:00:00Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_replay",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:00Z",
                    }),
                ),
                persisted(
                    2,
                    "2026-01-01T00:00:01Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_replay",
                        "verdict": "warn",
                    }),
                ),
            ],
        );

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let (handle, mut rx) = test_handle(session_id);
        state.sessions.insert_for_test(session_id, handle);
        let mut cmd = make_cmd("cmd_replay", session_id, "assessment.replay");
        cmd.payload = json!({ "run_id": "run_replay" });

        let (ack, events) = dispatch_assessment_replay(&cmd, &state).await;
        assert!(ack.ok);
        assert!(events.is_empty());

        let replayed = rx.recv().await.expect("replayed event");
        assert_eq!(replayed.event_type, "assessment.replayed");
        assert_eq!(replayed.payload["query_source"], json!("event_log"));
        assert_eq!(
            replayed.payload["fallback_reason"],
            json!("index_incomplete")
        );
        assert_eq!(replayed.payload["run"]["query_source"], json!("event_log"));
        assert_eq!(
            replayed.payload["run"]["fallback_reason"],
            json!("index_incomplete")
        );

        let report_mark = rx.recv().await.expect("report mark event");
        assert_eq!(report_mark.event_type, "assessment.report_fetched");
        assert_eq!(report_mark.payload["query_source"], json!("event_log"));
        assert_eq!(
            report_mark.payload["fallback_reason"],
            json!("index_incomplete")
        );
    }

    #[tokio::test]
    async fn assessment_diff_emits_query_source_event_log_with_fallback_reason() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_diff";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    "2026-01-01T00:00:00Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_base",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:00Z",
                    }),
                ),
                persisted(
                    2,
                    "2026-01-01T00:00:01Z",
                    "assessment.finding_added",
                    json!({
                        "finding_id": "finding_base",
                        "identity_hash": "hash_base",
                        "run_id": "run_base",
                        "category": "technical",
                        "subject": "src/base.ts",
                        "check": "check",
                        "severity": "low",
                        "confidence": 0.9,
                        "title": "Base finding",
                        "summary": "Summary",
                        "evidence_ids": [],
                    }),
                ),
                persisted(
                    3,
                    "2026-01-01T00:00:02Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_base",
                        "verdict": "warn",
                    }),
                ),
                persisted(
                    4,
                    "2026-01-01T00:00:03Z",
                    "assessment.started",
                    json!({
                        "run_id": "run_next",
                        "swarm": "rtd",
                        "started_at": "2026-01-01T00:00:03Z",
                    }),
                ),
                persisted(
                    5,
                    "2026-01-01T00:00:04Z",
                    "assessment.completed",
                    json!({
                        "run_id": "run_next",
                        "verdict": "warn",
                    }),
                ),
            ],
        );

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let (handle, mut rx) = test_handle(session_id);
        state.sessions.insert_for_test(session_id, handle);
        let mut cmd = make_cmd("cmd_diff", session_id, "assessment.diff");
        cmd.payload = json!({
            "base_run_id": "run_base",
            "next_run_id": "run_next",
        });

        let (ack, events) = dispatch_assessment_diff(&cmd, &state).await;
        assert!(ack.ok);
        assert!(events.is_empty());

        let event = rx.recv().await.expect("diff event");
        assert_eq!(event.event_type, "assessment.diffed");
        assert_eq!(event.payload["query_source"], json!("event_log"));
        assert_eq!(event.payload["fallback_reason"], json!("index_incomplete"));
        assert_eq!(
            event.payload["base_run"]["query_source"],
            json!("event_log")
        );
        assert_eq!(
            event.payload["base_run"]["fallback_reason"],
            json!("index_incomplete")
        );
        assert_eq!(
            event.payload["next_run"]["query_source"],
            json!("event_log")
        );
        assert_eq!(
            event.payload["next_run"]["fallback_reason"],
            json!("index_incomplete")
        );
    }

    #[tokio::test]
    async fn assessment_index_rebuild_restores_index_rows_from_canonical_events() {
        let tmp = TempDir::new().expect("tempdir");
        let persistence = make_file_persistence(&tmp);
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        let session_id = "sess_rebuild";
        let started_at = "2026-01-01T00:00:01Z";
        let finding_emitted_at = "2026-01-01T00:00:02Z";
        let completed_at = "2026-01-01T00:00:03Z";
        let sweep_started_at = "2026-01-01T00:00:00Z";
        let sweep_completed_at = "2026-01-01T00:00:04Z";

        seed_session(
            &persistence,
            session_id,
            tmp.path(),
            &[
                persisted(
                    1,
                    sweep_started_at,
                    "assessment.sweep.started",
                    json!({
                        "sweep_id": "sweep_01",
                        "status": "running",
                        "started_at": sweep_started_at,
                        "families": ["rtd", "security"],
                    }),
                ),
                persisted(
                    2,
                    started_at,
                    "assessment.started",
                    json!({
                        "run_id": "run_01",
                        "swarm": "rtd",
                        "started_at": started_at,
                    }),
                ),
                persisted(
                    3,
                    finding_emitted_at,
                    "assessment.finding_added",
                    json!({
                        "finding_id": "finding_01",
                        "identity_hash": "hash_01",
                        "run_id": "run_01",
                        "category": "technical",
                        "severity": "high",
                        "title": "Finding 1",
                    }),
                ),
                persisted(
                    4,
                    completed_at,
                    "assessment.completed",
                    json!({
                        "run_id": "run_01",
                        "verdict": "warn",
                    }),
                ),
                persisted(
                    5,
                    sweep_completed_at,
                    "assessment.sweep.completed",
                    json!({
                        "sweep_id": "sweep_01",
                        "status": "completed",
                        "verdict": "warn",
                    }),
                ),
            ],
        );

        index
            .record_run(&AssessmentRunRow {
                run_id: "stale_run".to_string(),
                session_id: session_id.to_string(),
                swarm: "legacy".to_string(),
                status: "running".to_string(),
                started_at: "2025-01-01T00:00:00Z".to_string(),
                completed_at: None,
                verdict: None,
                payload_json: json!({"run_id": "stale_run"}).to_string(),
            })
            .expect("seed stale run");

        let state = make_state(
            Some(Arc::clone(&persistence)),
            Some(Arc::clone(&index)),
            &tmp,
        );
        let cmd = make_cmd("cmd_index_rebuild", session_id, "assessment.index.rebuild");

        let (ack, events) = dispatch_assessment_index_rebuild(&cmd, &state).await;
        assert!(ack.ok);
        assert!(ack.error.is_none());
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event_type, "assessment.index.rebuild_started");
        assert_eq!(events[1].event_type, "assessment.index.rebuild_progress");
        assert_eq!(events[2].event_type, "assessment.index.rebuilt");
        assert_eq!(events[2].payload["status"]["runs"], json!(1));
        assert_eq!(events[2].payload["status"]["findings"], json!(1));
        assert_eq!(events[2].payload["status"]["sweeps"], json!(1));
        assert_eq!(events[2].payload["sessions_processed"], json!(1));

        let status = index.status().expect("status");
        assert_eq!(status.runs, 1);
        assert_eq!(status.findings, 1);
        assert_eq!(status.sweeps, 1);
        assert_eq!(
            parse_utc(
                status
                    .last_indexed_at
                    .as_deref()
                    .expect("status last_indexed_at")
            ),
            parse_utc(sweep_completed_at)
        );
        assert!(index
            .get_run("stale_run")
            .expect("stale run query")
            .is_none());
        assert!(index.get_run("run_01").expect("run query").is_some());
        assert_eq!(index.list_findings("run_01").expect("findings").len(), 1);
        assert!(index.get_sweep("sweep_01").expect("sweep query").is_some());
    }

    #[tokio::test]
    async fn assessment_index_rebuild_failure_keeps_existing_rows_when_canonical_replay_fails() {
        let tmp = TempDir::new().expect("tempdir");
        let index = Arc::new(AssessmentIndex::open_in_memory().expect("open index"));
        index
            .record_run(&AssessmentRunRow {
                run_id: "stale_run".to_string(),
                session_id: "sess_rebuild_fail".to_string(),
                swarm: "legacy".to_string(),
                status: "running".to_string(),
                started_at: "2025-01-01T00:00:00Z".to_string(),
                completed_at: None,
                verdict: None,
                payload_json: json!({"run_id": "stale_run"}).to_string(),
            })
            .expect("seed stale run");

        let meta = session_meta("sess_rebuild_fail", tmp.path());
        let persistence: SharedPersistence = Arc::new(FailingReplayPersistence { meta });
        let state = make_state(Some(persistence), Some(Arc::clone(&index)), &tmp);
        let cmd = make_cmd(
            "cmd_index_rebuild_fail",
            "sess_rebuild_fail",
            "assessment.index.rebuild",
        );

        let (ack, events) = dispatch_assessment_index_rebuild(&cmd, &state).await;
        assert!(!ack.ok);
        assert_eq!(
            ack.error.as_ref().map(|e| e.code.as_str()),
            Some("assessment.index_rebuild_failed")
        );
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, "assessment.index.rebuild_started");
        assert_eq!(events[1].event_type, "assessment.index.rebuild_failed");
        assert_eq!(events[1].payload["phase"], json!("canonical_replay"));
        assert_eq!(index.status().expect("status").runs, 1);
        assert!(index
            .get_run("stale_run")
            .expect("stale run query")
            .is_some());
    }
}
