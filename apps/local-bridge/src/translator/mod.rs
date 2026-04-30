//! Command dispatch (WS client → session) + envelope translation.

use crate::agent_runtime::acp::{sha256_hex_canonical_excluding, TOOL_CALL_HASH_DROP_FIELDS};
use crate::audit::log_tool_event;
use crate::handoff::packet::{ExecutionOutcome, TaskExecutionProgress};
use crate::profile_layer::{enforce_action, EnforceOutcome};
use crate::server::AppStateHandle;
use crate::session::persistence::SessionHistoryFilter;
use crate::session::{AuthenticateError, SessionHandleRef};
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use bridge_core::{AuditSeverity, ReplayResult};
use profile_core::{enforce::enforce_agent_kind, profile::CapabilityProfile, Decision};
use serde_json::json;
use std::sync::Arc;
use tracing::warn;
use ulid::Ulid;

mod assessment;
mod assessment_query;
pub mod assessment_schema;

fn session_ready_payload(handle: &SessionHandleRef) -> serde_json::Value {
    let mut payload = json!({
        "id": handle.id,
        "session_id": handle.id,
        "profile_id": handle.profile_id,
        "project_root": handle.project_root,
        "agent_id": handle.agent_id,
        "agent_kind": handle.agent_kind.as_str(),
        "workflow_id": handle.workflow_spec_id,
        "workflow_name": handle.workflow_spec_name,
        "auth_methods": handle
            .acp
            .as_ref()
            .map(|a| a.auth_methods.clone())
            .unwrap_or_else(|| json!([])),
    });
    if let Some(acp) = handle.acp.as_ref() {
        let obj = payload.as_object_mut().unwrap();
        obj.insert("agent_capabilities".into(), acp.agent_capabilities.clone());
        obj.insert("agent_info".into(), acp.agent_info.clone());
    }
    payload
}

fn session_ready_event(handle: &SessionHandleRef, ts: String) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: handle.id.clone(),
        event_type: "session.ready".into(),
        payload: session_ready_payload(handle),
        v: 1,
        ts,
    }
}

fn session_bootstrap_events(
    handle: &SessionHandleRef,
    ts: String,
    verb: &'static str,
) -> Vec<ServerEvent> {
    use crate::notify::{activity_event, notify_event, system_pulse_event, Lane, Severity};

    let label = match verb {
        "resumed" => "Session resumed",
        _ => "Session ready",
    };
    vec![
        session_ready_event(handle, ts.clone()),
        ServerEvent {
            seq: 0,
            session_id: handle.id.clone(),
            event_type: "system.capabilities".into(),
            payload: crate::capabilities::capabilities_payload(),
            v: 1,
            ts: ts.clone(),
        },
        notify_event(
            handle.id.clone(),
            Lane::Transient,
            Severity::Ok,
            "session",
            label,
            &format!("Profile: {}", handle.profile_id),
        ),
        system_pulse_event(
            handle.id.clone(),
            vec![
                ("profile", handle.profile_id.as_str(), "ok"),
                ("session_count", "1 active", "ok"),
            ],
        ),
        activity_event(
            handle.id.clone(),
            "session",
            Severity::Info,
            &format!("Session {verb} with {}", handle.profile_id),
        ),
    ]
}

pub async fn dispatch_command(
    cmd: ClientCommand,
    state: AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let mut events = vec![];

    // Profile enforcement intercept (also catches unknown commands).
    match enforce_action(&cmd, &state) {
        EnforceOutcome::Allowed => {}
        EnforceOutcome::Denied { code, reason } => {
            state.audit.log(
                &cmd.session_id,
                "profile",
                AuditSeverity::Warn,
                json!({
                    "decision": "deny",
                    "tool": cmd.cmd_type,
                    "code": code,
                    "reason": reason,
                }),
            );
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: code.into(),
                        message: reason,
                    }),
                },
                events,
            );
        }
        EnforceOutcome::UnknownCommand => {
            log_tool_event(
                &state,
                &cmd.session_id,
                "protocol",
                json!({ "decision": "deny", "reason": "unknown command type", "type": cmd.cmd_type }),
            );
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "protocol.unknown_command".into(),
                        message: format!("unknown command type '{}'", cmd.cmd_type),
                    }),
                },
                events,
            );
        }
    }

    match cmd.cmd_type.as_str() {
        "system.ping" => (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: true,
                error: None,
            },
            events,
        ),
        "session.create" => {
            let profile_id = cmd
                .payload
                .get("profile_id")
                .and_then(|v| v.as_str())
                .unwrap_or("assessor.rtd@1.0.0")
                .to_string();
            let project_root: std::path::PathBuf = cmd
                .payload
                .get("project_root")
                .and_then(|v| v.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_default();
            // Stage X.4 — additive `agent_id` on session.create.
            // Pre-X.4 payloads omit this field and fall through to the
            // bridge's default agent.
            let requested_agent_id = cmd
                .payload
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            // Workflow selection: optional `workflow_id` from client.
            let requested_workflow_id = cmd
                .payload
                .get("workflow_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            // Validate profile exists before spawn — avoids ack-ok-then-crash.
            let profile_path = state.profile_root.join(format!("{profile_id}.yaml"));
            if !profile_path.exists() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "profile.not_found".into(),
                            message: format!("profile {profile_id} not found"),
                        }),
                    },
                    events,
                );
            }

            // Resolve the agent we'd actually spawn. Stage X.4 gives
            // priority to a requested `agent_id`; X.1 default is used
            // when the field is absent. Unknown / disabled selections
            // produce dedicated error codes so web clients can react
            // distinctly from policy denials.
            let registry = state.sessions.agents();
            let resolved_agent = match requested_agent_id.as_deref() {
                Some(id) => match registry.get(id) {
                    Ok(a) => {
                        if !a.enabled {
                            state.audit.log(
                                &cmd.session_id,
                                "agent",
                                AuditSeverity::Warn,
                                json!({
                                    "decision": "deny",
                                    "code": "agent.disabled",
                                    "reason": format!("agent '{id}' is disabled"),
                                    "agent_id": id,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "agent.disabled".into(),
                                        message: format!("agent '{id}' is disabled"),
                                    }),
                                },
                                events,
                            );
                        }
                        a.clone()
                    }
                    Err(_) => {
                        state.audit.log(
                            &cmd.session_id,
                            "agent",
                            AuditSeverity::Warn,
                            json!({
                                "decision": "deny",
                                "code": "agent.not_registered",
                                "reason": format!("agent '{id}' is not registered"),
                                "agent_id": id,
                            }),
                        );
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "agent.not_registered".into(),
                                    message: format!("agent '{id}' is not registered"),
                                }),
                            },
                            events,
                        );
                    }
                },
                None => registry.default_agent().clone(),
            };
            let agent_kind_str = resolved_agent.kind.as_str();

            // Stage X.2 — enforce profile.allowed_agent_kinds against
            // the *resolved* agent (X.4 may have selected a non-default).
            match CapabilityProfile::load(&profile_id, &state.profile_root) {
                Ok(profile) => match enforce_agent_kind(&profile, agent_kind_str) {
                    Decision::Allow => {}
                    Decision::Deny { code, reason } => {
                        state.audit.log(
                            &cmd.session_id,
                            "agent",
                            AuditSeverity::Warn,
                            json!({
                                "decision": "deny",
                                "code": code,
                                "reason": reason,
                                "profile_id": profile_id,
                                "agent_id": resolved_agent.id,
                                "agent_kind": agent_kind_str,
                            }),
                        );
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: code.into(),
                                    message: reason,
                                }),
                            },
                            events,
                        );
                    }
                },
                Err(e) => {
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "profile.load_failed".into(),
                                message: e.to_string(),
                            }),
                        },
                        events,
                    );
                }
            }

            // Validate workflow_id. Unknown id → ack false immediately; no
            // session is created. Arbitrary paths/URLs are rejected by the
            // allowlist (registry only contains bundled compile-time specs).
            if let Some(wid) = requested_workflow_id.as_deref() {
                use crate::workflows::WorkflowRegistry;
                if WorkflowRegistry::global().get(wid).is_none() {
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "workflow.not_found".into(),
                                message: format!("workflow '{wid}' is not a bundled workflow"),
                            }),
                        },
                        events,
                    );
                }
            }
            let effective_workflow_id = requested_workflow_id;

            match state
                .sessions
                .create_with_agent_and_workflow(
                    profile_id.clone(),
                    project_root.clone(),
                    requested_agent_id.as_deref(),
                    effective_workflow_id,
                )
                .await
            {
                Ok(handle) => {
                    state.audit.log(
                        &handle.id,
                        "session",
                        AuditSeverity::Info,
                        json!({
                            "event": "created",
                            "profile_id": profile_id,
                            "project_root": project_root,
                            "agent_id": handle.agent_id,
                            "agent_kind": handle.agent_kind.as_str(),
                            "workflow_id": handle.workflow_spec_id,
                        }),
                    );
                    let now = chrono::Utc::now().to_rfc3339();
                    let session_events = session_bootstrap_events(&handle, now.clone(), "created");
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        session_events,
                    )
                }
                Err(e) => {
                    warn!(error = %e, "session.create failed");
                    state.audit.log(
                        &cmd.session_id,
                        "session",
                        AuditSeverity::Error,
                        json!({ "event": "create_failed", "error": e.to_string() }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "session.spawn_failed".into(),
                                message: e.to_string(),
                            }),
                        },
                        events,
                    )
                }
            }
        }
        "session.list" => {
            let list = state.sessions.list();
            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "session.list_response".into(),
                payload: json!({ "sessions": list }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                events,
            )
        }
        "config.policy.get" => {
            // Stage R3 — expose the active session-resume policy to the
            // FE so the persistent sessions panel can render the
            // "Resume policy" preview block (default mode, drift,
            // retention, max events). Read-only: the FE never mutates
            // policy directly; that's the operator's job via YAML +
            // R4's reload command.
            let p = &state.resume_policy;
            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "config.validated".into(),
                payload: json!({
                    "scope": "session_resume",
                    "ok": true,
                    "policy": {
                        "default_mode": p.default_mode.as_str(),
                        "native_fallback": p.native_fallback.as_str(),
                        "mcp_server_drift": p.mcp_server_drift.as_str(),
                        "profile_class_mismatch": p.profile_class_mismatch.as_str(),
                        "retention_days": p.retention_days,
                        "max_events": p.max_events,
                    },
                }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                events,
            )
        }
        "assessment.run" => assessment::dispatch_assessment_run(&cmd, &state).await,
        "assessment.sweep.run" => assessment::dispatch_assessment_sweep_run(&cmd, &state).await,
        "assessment.cancel" => assessment::dispatch_assessment_cancel(&cmd, &state).await,
        "assessment.sweep.cancel" => {
            assessment::dispatch_assessment_sweep_cancel(&cmd, &state).await
        }
        "assessment.list_runs" => {
            assessment_query::dispatch_assessment_list_runs(&cmd, &state).await
        }
        "assessment.fetch_report" => {
            assessment_query::dispatch_assessment_fetch_report(&cmd, &state).await
        }
        "assessment.replay" => assessment_query::dispatch_assessment_replay(&cmd, &state).await,
        "assessment.diff" => assessment_query::dispatch_assessment_diff(&cmd, &state).await,
        "assessment.fetch_evidence_preview" => {
            assessment_query::dispatch_assessment_fetch_evidence_preview(&cmd, &state).await
        }
        "session.resume" => {
            // Stage X6 batch 4-3 / 4-4 / 4-5 — resume mode dispatch
            // matrix. Batches 4-4 and 4-5 wired the native ACP
            // `session/load` path end-to-end (registry +
            // `spawn_acp(resume_native: Some(…))`) and added the
            // `session.replay.progress` ticks the FE chip listens for.
            // | mode             | meta    | caps           | action                                                      |
            // | ---------------- | ------- | -------------- | ----------------------------------------------------------- |
            // | absent           | n/a     | n/a            | legacy in-memory ring replay (cmd.session_id)               |
            // | replay_only      | required| n/a            | persistence replay (Phase 3)                                 |
            // | acp_load         | missing | n/a            | reject `vac_session_unknown`                                 |
            // | acp_load         | required| caps=false     | reject `native_resume_unsupported`                           |
            // | acp_load         | required| caps=true      | spawn + native `session/load`; on Unsupported -> hard reject |
            // | native_or_replay | missing | n/a            | reject `vac_session_unknown`                                 |
            // | native_or_replay | required| caps=false     | fallback to persistence replay, resume_mode=replay_only_fallback |
            // | native_or_replay | required| caps=true      | try native; on Unsupported -> replay_only_fallback           |
            // | <unknown>        | any     | any            | reject `unknown_resume_mode`                                  |
            let raw_requested_mode = cmd
                .payload
                .get("resume_mode")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let vac_session_id = cmd
                .payload
                .get("vac_session_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            // Stage R3 — if the client omits `resume_mode` AND there's a
            // persisted session to attach to, inject the policy default
            // so behavior is predictable across new vs old clients.
            // When there's no `vac_session_id` we keep the legacy
            // in-memory ring path — that's a different code path that
            // doesn't even consult persistence.
            let requested_mode: Option<String> =
                match (raw_requested_mode.as_deref(), vac_session_id.as_deref()) {
                    (Some(_), _) => raw_requested_mode.clone(),
                    (None, Some(_)) => Some(state.resume_policy.default_mode.as_str().to_string()),
                    (None, None) => None,
                };

            // Reject obviously unknown mode strings up front so a typo
            // can't silently downgrade to legacy ring replay.
            if let Some(ref m) = requested_mode {
                if !matches!(m.as_str(), "replay_only" | "acp_load" | "native_or_replay") {
                    let target_id = vac_session_id
                        .clone()
                        .unwrap_or_else(|| cmd.session_id.clone());
                    events.push(ServerEvent {
                        seq: 0,
                        session_id: target_id.clone(),
                        event_type: "session.resume.failed".into(),
                        payload: json!({
                            "vac_session_id": target_id,
                            "mode": m,
                            "reason": "unknown_resume_mode",
                            "requested_mode": m,
                        }),
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    });
                    state.audit.log(
                        &target_id,
                        "session",
                        AuditSeverity::Warn,
                        json!({
                            "event": "resume_failed",
                            "reason": "unknown_resume_mode",
                            "requested_mode": m,
                        }),
                    );
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "session.unknown_resume_mode".into(),
                                message: format!("unknown resume_mode `{}`", m),
                            }),
                        },
                        events,
                    );
                }
            }

            // Native-style modes (`acp_load`, `native_or_replay`) require
            // a persistence layer + a vac_session_id with valid meta.
            // Branch out before we hit the legacy paths so the failure
            // reasons stay specific.
            if matches!(
                requested_mode.as_deref(),
                Some("acp_load") | Some("native_or_replay")
            ) {
                let mode_str = requested_mode.clone().unwrap();
                let Some(target_id) = vac_session_id.clone() else {
                    events.push(ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "session.resume.failed".into(),
                        payload: json!({
                            "vac_session_id": null,
                            "mode": mode_str,
                            "reason": "vac_session_unknown",
                            "detail": "resume_mode requires vac_session_id",
                        }),
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    });
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "session.vac_session_unknown".into(),
                                message: format!(
                                    "resume_mode `{}` requires vac_session_id",
                                    mode_str
                                ),
                            }),
                        },
                        events,
                    );
                };
                let Some(persistence) = state.persistence.clone() else {
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "persistence.disabled".into(),
                                message: "session persistence is not configured".into(),
                            }),
                        },
                        events,
                    );
                };
                let meta = match persistence.load_meta(&target_id) {
                    Ok(Some(m)) => m,
                    Ok(None) => {
                        events.push(ServerEvent {
                            seq: 0,
                            session_id: target_id.clone(),
                            event_type: "session.resume.failed".into(),
                            payload: json!({
                                "vac_session_id": target_id,
                                "mode": mode_str,
                                "reason": "vac_session_unknown",
                            }),
                            v: 1,
                            ts: chrono::Utc::now().to_rfc3339(),
                        });
                        state.audit.log(
                            &target_id,
                            "session",
                            AuditSeverity::Warn,
                            json!({
                                "event": "resume_failed",
                                "reason": "vac_session_unknown",
                                "mode": mode_str,
                            }),
                        );
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "session.vac_session_unknown".into(),
                                    message: target_id.clone(),
                                }),
                            },
                            events,
                        );
                    }
                    Err(err) => {
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "persistence.load_failed".into(),
                                    message: err.to_string(),
                                }),
                            },
                            events,
                        );
                    }
                };
                let caps_supported = meta.native_resume.load_session_supported;

                // acp_load REQUIRES caps=true. caps=false is a hard reject.
                if mode_str == "acp_load" && !caps_supported {
                    events.push(ServerEvent {
                        seq: 0,
                        session_id: target_id.clone(),
                        event_type: "session.resume.failed".into(),
                        payload: json!({
                            "vac_session_id": target_id,
                            "mode": mode_str,
                            "reason": "native_resume_unsupported",
                            "detail": "agent_capabilities.loadSession=false",
                        }),
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    });
                    state.audit.log(
                        &target_id,
                        "session",
                        AuditSeverity::Warn,
                        json!({
                            "event": "resume_failed",
                            "reason": "native_resume_unsupported",
                            "mode": mode_str,
                        }),
                    );
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "session.native_resume_unsupported".into(),
                                message: "agent does not advertise loadSession".into(),
                            }),
                        },
                        events,
                    );
                }

                // caps=true (both modes) — attempt native ACP
                // `session/load` via the registry. Stage X6 4-4 wires
                // this end-to-end: validate meta, spawn ACP child with
                // `resume_native: Some(...)`, drive pumps, then issue
                // `session/load`. The handle emits its own
                // `session.resume.started` / `session.resumed` /
                // `vac.session_resumed_native` events from inside
                // `spawn_acp`, so on Started we just ack ok=true.
                if caps_supported {
                    let mode_static: &'static str = match mode_str.as_str() {
                        "acp_load" => "acp_load",
                        "native_or_replay" => "native_or_replay",
                        // Unreachable — we already filtered to these two.
                        _ => unreachable!("caps_supported branch reached with unexpected mode"),
                    };
                    // Stage X6 batch C1 + R3 — emit a policy-driven MCP
                    // drift event when the persisted session's
                    // `mcp_servers` differ from what the live agent
                    // registry currently advertises. We do this BEFORE
                    // calling resume_native so the FE can render the
                    // event even on hard failure paths (caps mismatch /
                    // Validation outcomes). Under `mcp_server_drift: fail`
                    // we short-circuit the resume entirely.
                    match build_mcp_drift_event(&state, &meta, &target_id, mode_str.as_str()) {
                        McpDriftAction::None => {}
                        McpDriftAction::Warn(event) => {
                            events.push(event);
                        }
                        McpDriftAction::Fail(event) => {
                            events.push(event);
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "session.mcp_server_drift".into(),
                                        message:
                                            "persisted MCP servers differ from live agent advertisement"
                                                .into(),
                                    }),
                                },
                                events,
                            );
                        }
                    }
                    let outcome = state.sessions.resume_native(&meta, mode_static).await;
                    use crate::session::{ResumeNativeOutcome, ResumeValidationFailure};
                    match outcome {
                        ResumeNativeOutcome::Started { handle, warnings } => {
                            // Handle already emitted session.resume.initializing,
                            // vac.session_resumed_native, replayed fixture
                            // updates, and session.resumed via spawn_acp.
                            // Drain the per-session ring and forward those
                            // events on the dispatch return path so the WS
                            // client sees them — auto-subscribe doesn't
                            // attach until *after* dispatch_command returns,
                            // and the resume lifecycle events are emitted
                            // *during* spawn. Without this drain the
                            // cockpit's resume chip would never observe
                            // `session.resumed`.
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Info,
                                json!({
                                    "event": "resume_started",
                                    "mode": mode_str,
                                    "resume_mode": "native",
                                }),
                            );
                            // Stage R2 — emit any pre-spawn validation
                            // warnings BEFORE draining the resume
                            // lifecycle ring so the FE warning chip
                            // shows up in the same dispatch response
                            // that carries `session.resumed`. Each
                            // warning is a single-line
                            // `session.resume.warning` event keyed by
                            // a stable lowercase reason string
                            // (`profile_class_missing`, etc).
                            for warning in &warnings {
                                events.push(ServerEvent {
                                    seq: 0,
                                    session_id: target_id.clone(),
                                    event_type: "session.resume.warning".into(),
                                    payload: json!({
                                        "vac_session_id": target_id,
                                        "mode": mode_str,
                                        "reason": warning.reason(),
                                    }),
                                    v: 1,
                                    ts: chrono::Utc::now().to_rfc3339(),
                                });
                                state.audit.log(
                                    &target_id,
                                    "session",
                                    AuditSeverity::Warn,
                                    json!({
                                        "event": "resume_warning",
                                        "reason": warning.reason(),
                                        "mode": mode_str,
                                    }),
                                );
                            }
                            let ring = handle.ring.read().await;
                            if let ReplayResult::Stream(evs) = ring.replay_after(0) {
                                events.extend(evs.into_iter().map(|(seq, mut ev)| {
                                    ev.seq = seq;
                                    ev
                                }));
                            }
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: true,
                                    error: None,
                                },
                                events,
                            );
                        }
                        ResumeNativeOutcome::Unsupported
                            if mode_static == "native_or_replay"
                                && matches!(
                                    state.resume_policy.native_fallback,
                                    crate::config::NativeFallbackPolicy::Fail
                                ) =>
                        {
                            // Stage R3 — `native_fallback: fail` makes the
                            // unsupported case explicit instead of silently
                            // downshifting to persistence replay. Same shape
                            // as the acp_load Unsupported reject below so
                            // the FE renders one consistent failed-state.
                            events.push(ServerEvent {
                                seq: 0,
                                session_id: target_id.clone(),
                                event_type: "session.resume.failed".into(),
                                payload: json!({
                                    "vac_session_id": target_id,
                                    "mode": mode_str,
                                    "reason": "native_resume_unsupported",
                                    "detail": "agent rejected session/load with method-not-found",
                                    "policy": "native_fallback=fail",
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            });
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Warn,
                                json!({
                                    "event": "resume_failed",
                                    "reason": "native_resume_unsupported",
                                    "mode": mode_str,
                                    "policy": "native_fallback=fail",
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "session.native_resume_unsupported".into(),
                                        message: "agent does not implement session/load (policy: native_fallback=fail)".into(),
                                    }),
                                },
                                events,
                            );
                        }
                        ResumeNativeOutcome::Unsupported if mode_static == "native_or_replay" => {
                            // Documented matrix outcome — fall through to
                            // persistence replay with the distinguishing
                            // `replay_only_fallback` resume_mode.
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Info,
                                json!({
                                    "event": "resume_native_unsupported_fallback",
                                    "mode": mode_str,
                                }),
                            );
                            return resume_persistence_replay(
                                cmd,
                                state,
                                persistence,
                                target_id,
                                meta,
                                "native_or_replay",
                                "replay_only_fallback",
                                events,
                            )
                            .await;
                        }
                        ResumeNativeOutcome::Unsupported => {
                            // mode_static == "acp_load" — hard reject.
                            events.push(ServerEvent {
                                seq: 0,
                                session_id: target_id.clone(),
                                event_type: "session.resume.failed".into(),
                                payload: json!({
                                    "vac_session_id": target_id,
                                    "mode": mode_str,
                                    "reason": "native_resume_unsupported",
                                    "detail": "agent rejected session/load with method-not-found",
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            });
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Warn,
                                json!({
                                    "event": "resume_failed",
                                    "reason": "native_resume_unsupported",
                                    "mode": mode_str,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "session.native_resume_unsupported".into(),
                                        message: "agent does not implement session/load".into(),
                                    }),
                                },
                                events,
                            );
                        }
                        ResumeNativeOutcome::Rejected(detail) => {
                            events.push(ServerEvent {
                                seq: 0,
                                session_id: target_id.clone(),
                                event_type: "session.resume.failed".into(),
                                payload: json!({
                                    "vac_session_id": target_id,
                                    "mode": mode_str,
                                    "reason": "native_resume_rejected",
                                    "detail": detail,
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            });
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Warn,
                                json!({
                                    "event": "resume_failed",
                                    "reason": "native_resume_rejected",
                                    "mode": mode_str,
                                    "detail": detail,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "session.native_resume_rejected".into(),
                                        message: detail,
                                    }),
                                },
                                events,
                            );
                        }
                        ResumeNativeOutcome::Failed(detail) => {
                            events.push(ServerEvent {
                                seq: 0,
                                session_id: target_id.clone(),
                                event_type: "session.resume.failed".into(),
                                payload: json!({
                                    "vac_session_id": target_id,
                                    "mode": mode_str,
                                    "reason": "native_resume_failed",
                                    "detail": detail,
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            });
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Error,
                                json!({
                                    "event": "resume_failed",
                                    "reason": "native_resume_failed",
                                    "mode": mode_str,
                                    "detail": detail,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "session.native_resume_failed".into(),
                                        message: detail,
                                    }),
                                },
                                events,
                            );
                        }
                        ResumeNativeOutcome::Validation(failure) => {
                            let reason = failure.reason();
                            // Validation errors that map onto existing
                            // ack codes get a specific code; otherwise
                            // we use the generic native_resume_failed
                            // wrapper so the FE has something to render.
                            let ack_code = match failure {
                                ResumeValidationFailure::VacSessionUnknown => {
                                    "session.vac_session_unknown"
                                }
                                ResumeValidationFailure::AgentNotInRegistry => {
                                    "session.agent_not_in_registry"
                                }
                                ResumeValidationFailure::AgentKindMismatch => {
                                    "session.agent_kind_mismatch"
                                }
                                ResumeValidationFailure::ProfileNotFound => {
                                    "session.profile_not_found"
                                }
                                ResumeValidationFailure::ProfileInvalid => {
                                    "session.profile_invalid"
                                }
                                ResumeValidationFailure::AgentKindNotAllowed => {
                                    "session.agent_kind_not_allowed"
                                }
                                ResumeValidationFailure::ProjectRootUnavailable => {
                                    "session.project_root_unavailable"
                                }
                                // Stage R2 — hard fail when persisted
                                // `profile_class` differs from the live
                                // parsed profile's class. R3 may turn
                                // this into a policy-driven warning, but
                                // for now it always lands on a
                                // `session.resume.failed` ack.
                                ResumeValidationFailure::ProfileClassMismatch => {
                                    "session.profile_class_mismatch"
                                }
                            };
                            events.push(ServerEvent {
                                seq: 0,
                                session_id: target_id.clone(),
                                event_type: "session.resume.failed".into(),
                                payload: json!({
                                    "vac_session_id": target_id,
                                    "mode": mode_str,
                                    "reason": reason,
                                }),
                                v: 1,
                                ts: chrono::Utc::now().to_rfc3339(),
                            });
                            state.audit.log(
                                &target_id,
                                "session",
                                AuditSeverity::Warn,
                                json!({
                                    "event": "resume_failed",
                                    "reason": reason,
                                    "mode": mode_str,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: ack_code.into(),
                                        message: reason.into(),
                                    }),
                                },
                                events,
                            );
                        }
                    }
                }

                // mode_str must be "native_or_replay" with caps=false
                // here — fall back to persistence replay with the
                // distinguishing `replay_only_fallback` resume_mode.
                debug_assert_eq!(mode_str, "native_or_replay");
                debug_assert!(!caps_supported);
                return resume_persistence_replay(
                    cmd,
                    state,
                    persistence,
                    target_id,
                    meta,
                    "native_or_replay",
                    "replay_only_fallback",
                    events,
                )
                .await;
            }

            // Persistence-based replay path: when payload includes
            // vac_session_id and (optional) resume_mode == "replay_only".
            // Reconstruct transcript from disk via the shared helper.
            if let Some(target_id) = vac_session_id.clone() {
                let Some(persistence) = state.persistence.clone() else {
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "persistence.disabled".into(),
                                message: "session persistence is not configured".into(),
                            }),
                        },
                        events,
                    );
                };
                let meta = match persistence.load_meta(&target_id) {
                    Ok(Some(m)) => m,
                    Ok(None) => {
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "session.not_found".into(),
                                    message: target_id.clone(),
                                }),
                            },
                            events,
                        );
                    }
                    Err(err) => {
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "persistence.load_failed".into(),
                                    message: err.to_string(),
                                }),
                            },
                            events,
                        );
                    }
                };
                return resume_persistence_replay(
                    cmd,
                    state,
                    persistence,
                    target_id,
                    meta,
                    "replay_only",
                    "replay_only",
                    events,
                )
                .await;
            }

            let Some(handle) = state.sessions.get(&cmd.session_id) else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            };

            state.audit.log(
                &cmd.session_id,
                "session",
                AuditSeverity::Info,
                json!({ "event": "resumed" }),
            );
            handle
                .state
                .transition(bridge_core::SessionState::Active)
                .ok();

            let now = chrono::Utc::now().to_rfc3339();
            let mut out = session_bootstrap_events(&handle, now.clone(), "resumed");
            let ring = handle.ring.read().await;
            match ring.replay_after(0) {
                ReplayResult::Stream(evs) => {
                    out.extend(evs.into_iter().map(|(seq, mut ev)| {
                        ev.seq = seq;
                        ev
                    }));
                }
                ReplayResult::OutOfRange { oldest, requested } => {
                    warn!(
                        session_id = %handle.id,
                        oldest,
                        requested,
                        "session.resume replay requested older than retained ring"
                    );
                }
                ReplayResult::UpToDate => {}
            }

            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                out,
            )
        }
        "session.history.list" => {
            // Stage X6 P2-B: surface persistence health on every
            // listed payload so the cockpit chip can render even when
            // we never received the live `session.persistence_degraded`
            // broadcast (cold reload, stale tab, etc.). When persistence
            // is disabled entirely the FE should still see `healthy`
            // — "degraded" is reserved for an attached store that has
            // observed at least one append/save/forget failure.
            let health_str = if state.persistence_health.is_degraded() {
                "degraded"
            } else {
                "healthy"
            };
            let recent_failures: Vec<serde_json::Value> = state
                .persistence_health
                .recent_failures()
                .into_iter()
                .map(|f| {
                    json!({
                        "reason": f.reason,
                        "detail": f.detail,
                        "vac_session_id": f.vac_session_id,
                        "at": f.at,
                    })
                })
                .collect();
            let Some(persistence) = state.persistence.clone() else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: true,
                        error: None,
                    },
                    vec![ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "session.history.listed".into(),
                        payload: json!({
                            "sessions": [],
                            "persistence": "disabled",
                            "health": health_str,
                            "recent_failures": recent_failures,
                        }),
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    }],
                );
            };

            let project_root = cmd
                .payload
                .get("project_root")
                .and_then(|v| v.as_str())
                .map(std::path::PathBuf::from);
            let agent_id = cmd
                .payload
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let limit = cmd
                .payload
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);

            let filter = SessionHistoryFilter {
                project_root,
                agent_id,
                status: None,
                limit,
            };

            let metas = match persistence.list(&filter) {
                Ok(m) => m,
                Err(err) => {
                    return (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: "persistence.list_failed".into(),
                                message: err.to_string(),
                            }),
                        },
                        events,
                    );
                }
            };

            let sessions_json: Vec<serde_json::Value> = metas
                .into_iter()
                .map(|m| {
                    json!({
                        "vac_session_id": m.vac_session_id,
                        "agent_session_id": m.agent_session_id,
                        "agent_id": m.agent_id,
                        "agent_kind": m.agent_kind,
                        "project_root": m.project_root,
                        "profile_id": m.profile_id,
                        "workflow_id": m.workflow_id,
                        "created_at": m.created_at,
                        "updated_at": m.updated_at,
                        "status": m.status,
                        "native_resume": {
                            "load_session_supported": m.native_resume.load_session_supported,
                            "last_verified_at": m.native_resume.last_verified_at,
                        },
                    })
                })
                .collect();

            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "session.history.listed".into(),
                payload: json!({
                    "sessions": sessions_json,
                    "persistence": "file",
                    "health": health_str,
                    "recent_failures": recent_failures,
                }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });

            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                events,
            )
        }
        "session.history.forget" => {
            let Some(persistence) = state.persistence.clone() else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.disabled".into(),
                            message: "session persistence is not configured".into(),
                        }),
                    },
                    events,
                );
            };
            let Some(target_id) = cmd
                .payload
                .get("vac_session_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
            else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "protocol.invalid_payload".into(),
                            message: "vac_session_id required".into(),
                        }),
                    },
                    events,
                );
            };
            if let Err(err) = persistence.forget(&target_id) {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "persistence.forget_failed".into(),
                            message: err.to_string(),
                        }),
                    },
                    events,
                );
            }
            state.audit.log(
                &cmd.session_id,
                "session",
                AuditSeverity::Info,
                json!({ "event": "history.forgotten", "vac_session_id": target_id }),
            );
            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "session.history.forgotten".into(),
                payload: json!({ "vac_session_id": target_id }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                events,
            )
        }
        "session.close" => {
            if state.sessions.remove(&cmd.session_id).is_none() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            }
            state.audit.log(
                &cmd.session_id,
                "session",
                AuditSeverity::Info,
                json!({ "event": "closed", "reason": "user" }),
            );
            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "session.closed".into(),
                payload: json!({ "reason": "user" }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                events,
            )
        }
        "session.authenticate" => {
            // Stage X.5d — bridge-owned reauth. The bridge stays the
            // authority: it validates that the requested method id was
            // advertised by the adapter at initialize time, enforces the
            // terminal-capability HOLD, and emits structured audit +
            // ServerEvents that the cockpit listens to. The adapter only
            // sees the typed `authenticate` JSON-RPC call when allowed.
            let Some(handle) = state.sessions.get(&cmd.session_id) else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            };

            let method_id = cmd
                .payload
                .get("auth_method_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let Some(method_id) = method_id.filter(|s| !s.is_empty()) else {
                state.audit.log(
                    &cmd.session_id,
                    "session",
                    AuditSeverity::Warn,
                    json!({
                        "event": "auth_failed",
                        "code": "auth.invalid_payload",
                        "message": "auth_method_id is required",
                    }),
                );
                events.push(ServerEvent {
                    seq: 0,
                    session_id: cmd.session_id.clone(),
                    event_type: "session.auth_failed".into(),
                    payload: json!({
                        "code": "auth.invalid_payload",
                        "message": "auth_method_id is required",
                    }),
                    v: 1,
                    ts: chrono::Utc::now().to_rfc3339(),
                });
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "auth.invalid_payload".into(),
                            message: "auth_method_id is required".into(),
                        }),
                    },
                    events,
                );
            };

            // 1) auth_requested — audit + event before we touch the adapter.
            state.audit.log(
                &cmd.session_id,
                "session",
                AuditSeverity::Info,
                json!({
                    "event": "auth_requested",
                    "auth_method_id": method_id,
                }),
            );
            events.push(ServerEvent {
                seq: 0,
                session_id: cmd.session_id.clone(),
                event_type: "session.auth_requested".into(),
                payload: json!({
                    "auth_method_id": method_id,
                }),
                v: 1,
                ts: chrono::Utc::now().to_rfc3339(),
            });

            // 2) Drive the adapter handshake. SessionHandle owns the
            // policy gate (advertised methods, terminal HOLD, env_var
            // recreate path).
            match handle.authenticate_via_acp(&method_id).await {
                Ok(outcome) => {
                    state.audit.log(
                        &cmd.session_id,
                        "session",
                        AuditSeverity::Info,
                        json!({
                            "event": "auth_updated",
                            "auth_method_id": outcome.method_id,
                            "auth_method_type": outcome.method_type,
                        }),
                    );
                    events.push(ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "session.auth_updated".into(),
                        payload: json!({
                            "auth_method_id": outcome.method_id,
                            "auth_method_type": outcome.method_type,
                            "status": outcome.response.status,
                        }),
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    });
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        events,
                    )
                }
                Err(err) => {
                    let code = err.code();
                    let message = err.message();
                    let logged_method_id = err
                        .method_id()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| method_id.clone());
                    let logged_method_type = err.method_type().map(|s| s.to_string());
                    let env_var_vars = match &err {
                        AuthenticateError::EnvVarRecreateRequired { vars, .. } => {
                            Some(serde_json::Value::Array(vars.clone()))
                        }
                        _ => None,
                    };
                    state.audit.log(
                        &cmd.session_id,
                        "session",
                        AuditSeverity::Warn,
                        json!({
                            "event": "auth_failed",
                            "auth_method_id": logged_method_id,
                            "auth_method_type": logged_method_type,
                            "code": code,
                            "message": message,
                        }),
                    );
                    let mut payload = json!({
                        "auth_method_id": logged_method_id,
                        "code": code,
                        "message": message,
                    });
                    if let Some(t) = logged_method_type.as_ref() {
                        payload["auth_method_type"] = json!(t);
                    }
                    if let Some(vars) = env_var_vars {
                        payload["vars"] = vars;
                    }
                    events.push(ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "session.auth_failed".into(),
                        payload,
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    });
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: code.into(),
                                message,
                            }),
                        },
                        events,
                    )
                }
            }
        }
        "handoff.create" => {
            if state.sessions.get(&cmd.session_id).is_none() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            }

            let project_root = state
                .sessions
                .project_root(&cmd.session_id)
                .unwrap_or_else(|| std::path::PathBuf::from(""));

            let author = cmd
                .payload
                .get("created_by")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let now = chrono::Utc::now();

            let outcome = state
                .handoff
                .create_handoff(crate::handoff::HandoffCreateParams {
                    payload: &cmd.payload,
                    project_root: &project_root,
                    session_id: &cmd.session_id,
                    author: &author,
                    now,
                });

            let (ack, extra_events) = match outcome {
                crate::handoff::HandoffCreateOutcome::Ok {
                    ref packet,
                    ref upsert_event,
                    ref status_event,
                } => {
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Info,
                        serde_json::json!({
                            "event": "handoff.created",
                            "packet_id": packet.id,
                            "title": packet.title,
                            "author": author,
                            "repo_ref": packet.pin.repo_ref,
                            "base_commit_sha": packet.pin.base_commit_sha.chars().take(12).collect::<String>(),
                            "worktree_digest": packet.pin.worktree_digest.chars().take(12).collect::<String>(),
                            "invalidation_policy": packet.pin.invalidation_policy.as_str(),
                            "task_count": packet.tasks.len(),
                            "finding_count": packet.accepted_finding_ids.len(),
                        }),
                    );
                    let evts = vec![upsert_event.clone(), status_event.clone()];
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        evts,
                    )
                }
                crate::handoff::HandoffCreateOutcome::Err {
                    ref code,
                    ref message,
                } => (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: code.clone(),
                            message: message.clone(),
                        }),
                    },
                    vec![],
                ),
            };

            events.extend(extra_events);
            (ack, events)
        }
        "handoff.dispatch_local" => {
            let Some(source_handle) = state.sessions.get(&cmd.session_id) else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            };

            let packet_id = cmd
                .payload
                .get("packet_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if packet_id.is_empty() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "handoff.invalid_payload".into(),
                            message: "packet_id is required".into(),
                        }),
                    },
                    events,
                );
            }

            let project_root = state
                .sessions
                .project_root(&cmd.session_id)
                .unwrap_or_else(|| std::path::PathBuf::from(""));
            let now = chrono::Utc::now();

            match state.handoff.check_dispatch(&packet_id, &project_root, now) {
                Ok(packet) => {
                    let project_key = crate::handoff::project_key_for_packet(&packet);
                    if let Some(active) = state
                        .handoff
                        .active_executor_packet(&packet.target.executor_profile_id, &project_key)
                    {
                        let dispatch_err = crate::handoff::DispatchError::ExecutorBusy {
                            packet_id: active.id.clone(),
                            executor_profile_id: packet.target.executor_profile_id.clone(),
                        };
                        let reason_tag = dispatch_err.reason_tag();
                        let reason_msg = dispatch_err.message();
                        if let crate::handoff::HandoffDispatchRejectOutcome::Ok {
                            upsert_event,
                            status_event,
                            ..
                        } = state.handoff.record_dispatch_rejected(
                            &packet_id,
                            reason_tag,
                            Some(reason_msg.clone()),
                            &cmd.session_id,
                            now,
                        ) {
                            events.push(upsert_event);
                            events.push(status_event);
                        }
                        state.audit.log(
                            &cmd.session_id,
                            "handoff",
                            bridge_core::AuditSeverity::Warn,
                            serde_json::json!({
                                "event": "handoff.dispatch_rejected",
                                "packet_id": packet_id,
                                "code": dispatch_err.code(),
                                "reason_tag": reason_tag,
                                "reason": reason_msg,
                            }),
                        );
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: dispatch_err.code().into(),
                                    message: reason_msg,
                                }),
                            },
                            events,
                        );
                    }

                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Info,
                        serde_json::json!({
                            "event": "handoff.dispatch_allowed",
                            "packet_id": packet_id,
                            "repo_ref": packet.pin.repo_ref,
                        }),
                    );
                    let executor_handle = match state
                        .sessions
                        .create_with_agent_and_workflow(
                            packet.target.executor_profile_id.clone(),
                            project_root.clone(),
                            None,
                            None,
                        )
                        .await
                    {
                        Ok(handle) => handle,
                        Err(e) => {
                            let detail = e.to_string();
                            if let crate::handoff::HandoffDispatchRejectOutcome::Ok {
                                upsert_event,
                                status_event,
                                ..
                            } = state.handoff.record_dispatch_rejected(
                                &packet_id,
                                "provider_error",
                                Some(detail.clone()),
                                &cmd.session_id,
                                now,
                            ) {
                                events.push(upsert_event);
                                events.push(status_event);
                            }
                            state.audit.log(
                                &cmd.session_id,
                                "handoff",
                                bridge_core::AuditSeverity::Warn,
                                serde_json::json!({
                                    "event": "handoff.dispatch_rejected",
                                    "packet_id": packet_id,
                                    "code": "executor.spawn_failed",
                                    "reason_tag": "provider_error",
                                    "reason": detail,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "executor.spawn_failed".into(),
                                        message: detail,
                                    }),
                                },
                                events,
                            );
                        }
                    };

                    let listener_state = Arc::clone(&state);
                    let listener_source = Arc::clone(&source_handle);
                    let listener_packet_id = packet_id.clone();
                    let listener_executor_session_id = executor_handle.id.clone();
                    let mut listener_rx = executor_handle.broadcast.subscribe();
                    tokio::spawn(async move {
                        loop {
                            match listener_rx.recv().await {
                                Ok(event) => {
                                    let terminal = relay_executor_event(
                                        &listener_state,
                                        &listener_source,
                                        &listener_packet_id,
                                        &listener_executor_session_id,
                                        event,
                                    )
                                    .await;
                                    if terminal {
                                        break;
                                    }
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                    continue
                                }
                            }
                        }
                    });

                    match state
                        .handoff
                        .mark_dispatched(&packet_id, &cmd.session_id, now)
                    {
                        crate::handoff::HandoffDispatchOutcome::Ok {
                            upsert_event,
                            status_event,
                            ..
                        } => {
                            events.push(upsert_event);
                            events.push(status_event);
                        }
                        crate::handoff::HandoffDispatchOutcome::Err { code, message } => {
                            let _ = executor_handle.close_stdin().await;
                            state.audit.log(
                                &cmd.session_id,
                                "handoff",
                                bridge_core::AuditSeverity::Warn,
                                serde_json::json!({
                                    "event": "handoff.dispatch_state_error",
                                    "packet_id": packet_id,
                                    "code": code,
                                    "reason": message,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo { code, message }),
                                },
                                events,
                            );
                        }
                    }

                    match state.handoff.bind_executor_session(
                        &packet_id,
                        &executor_handle.id,
                        &cmd.session_id,
                        now,
                    ) {
                        crate::handoff::HandoffExecutionBindOutcome::Ok {
                            upsert_event,
                            status_event,
                            ..
                        } => {
                            events.push(upsert_event);
                            events.push(status_event);
                        }
                        crate::handoff::HandoffExecutionBindOutcome::Err { code, message } => {
                            let _ = executor_handle.close_stdin().await;
                            state.audit.log(
                                &cmd.session_id,
                                "handoff",
                                bridge_core::AuditSeverity::Warn,
                                serde_json::json!({
                                    "event": "handoff.execution_bind_failed",
                                    "packet_id": packet_id,
                                    "code": code,
                                    "reason": message,
                                }),
                            );
                            return (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo { code, message }),
                                },
                                events,
                            );
                        }
                    }

                    let executor_cmd = build_executor_submit_command(
                        &executor_handle.id,
                        &packet,
                        &cmd.session_id,
                    );
                    match executor_handle.send_client_command(&executor_cmd).await {
                        Ok(()) => (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: true,
                                error: None,
                            },
                            events,
                        ),
                        Err(e) => {
                            let detail = e.to_string();
                            let fallback_outcome = ExecutionOutcome {
                                status: "failed".into(),
                                tasks_completed: vec![],
                                tasks_failed: packet
                                    .tasks
                                    .iter()
                                    .map(|task| task.id.clone())
                                    .collect(),
                                changeset_summary: Some(detail.clone()),
                                reassessment_run_id: None,
                            };
                            if let crate::handoff::HandoffExecutionCompleteOutcome::Ok {
                                upsert_event,
                                status_event,
                                terminal_event,
                                ..
                            } = state.handoff.complete_execution(
                                &packet_id,
                                &executor_handle.id,
                                fallback_outcome,
                                &cmd.session_id,
                                now,
                            ) {
                                events.push(upsert_event);
                                events.push(status_event);
                                events.push(terminal_event);
                            }
                            let _ = executor_handle.close_stdin().await;
                            state.audit.log(
                                &cmd.session_id,
                                "handoff",
                                bridge_core::AuditSeverity::Warn,
                                serde_json::json!({
                                    "event": "handoff.execution_failed",
                                    "packet_id": packet_id,
                                    "code": "executor.dispatch_failed",
                                    "reason_tag": "provider_error",
                                    "reason": detail,
                                }),
                            );
                            (
                                ServerAck {
                                    ack_of: cmd.id.clone(),
                                    ok: false,
                                    error: Some(ErrorInfo {
                                        code: "executor.dispatch_failed".into(),
                                        message: detail,
                                    }),
                                },
                                events,
                            )
                        }
                    }
                }
                Err(dispatch_err) => {
                    let reason_tag = dispatch_err.reason_tag();
                    let reason_msg = dispatch_err.message();
                    if let crate::handoff::HandoffDispatchRejectOutcome::Ok {
                        upsert_event,
                        status_event,
                        ..
                    } = state.handoff.record_dispatch_rejected(
                        &packet_id,
                        reason_tag,
                        Some(reason_msg.clone()),
                        &cmd.session_id,
                        now,
                    ) {
                        events.push(upsert_event);
                        events.push(status_event);
                    }
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Warn,
                        serde_json::json!({
                            "event": "handoff.dispatch_rejected",
                            "packet_id": packet_id,
                            "code": dispatch_err.code(),
                            "reason_tag": reason_tag,
                            "reason": reason_msg,
                        }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: dispatch_err.code().into(),
                                message: reason_msg,
                            }),
                        },
                        events,
                    )
                }
            }
        }
        "handoff.approve" => {
            if state.sessions.get(&cmd.session_id).is_none() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            }

            let packet_id = cmd
                .payload
                .get("packet_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if packet_id.is_empty() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "handoff.invalid_payload".into(),
                            message: "packet_id is required".into(),
                        }),
                    },
                    events,
                );
            }

            let approver = cmd
                .payload
                .get("approver")
                .or_else(|| cmd.payload.get("signer"))
                .or_else(|| cmd.payload.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let role = cmd
                .payload
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("approver")
                .to_string();
            let reason = cmd
                .payload
                .get("reason")
                .and_then(|v| v.as_str())
                .map(String::from);

            let now = chrono::Utc::now();
            let outcome = state.handoff.approve_handoff(
                &packet_id,
                &approver,
                &role,
                reason,
                &cmd.session_id,
                now,
            );
            let (ack, extra_events) = match outcome {
                crate::handoff::HandoffApproveOutcome::Ok {
                    ref packet,
                    ref upsert_event,
                    ref status_event,
                    became_approved,
                } => {
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Info,
                        serde_json::json!({
                            "event": "handoff.approved",
                            "packet_id": packet.id,
                            "approver": approver,
                            "role": role,
                            "signers": packet.signers.len(),
                            "required_signers": packet.required_signers,
                            "status": packet.status.as_str(),
                            "became_approved": became_approved,
                        }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        vec![upsert_event.clone(), status_event.clone()],
                    )
                }
                crate::handoff::HandoffApproveOutcome::Err {
                    ref code,
                    ref message,
                } => {
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Warn,
                        serde_json::json!({
                            "event": "handoff.approve_failed",
                            "packet_id": packet_id,
                            "code": code,
                            "reason": message,
                        }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: code.clone(),
                                message: message.clone(),
                            }),
                        },
                        vec![],
                    )
                }
            };
            events.extend(extra_events);
            (ack, events)
        }
        "handoff.reject" => {
            if state.sessions.get(&cmd.session_id).is_none() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            }

            let packet_id = cmd
                .payload
                .get("packet_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if packet_id.is_empty() {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "handoff.invalid_payload".into(),
                            message: "packet_id is required".into(),
                        }),
                    },
                    events,
                );
            }

            let rejector = cmd
                .payload
                .get("rejector")
                .or_else(|| cmd.payload.get("by"))
                .or_else(|| cmd.payload.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let reason = cmd
                .payload
                .get("reason")
                .and_then(|v| v.as_str())
                .map(String::from);

            let now = chrono::Utc::now();
            let outcome = state.handoff.reject_handoff(
                &packet_id,
                &rejector,
                reason.clone(),
                &cmd.session_id,
                now,
            );
            let (ack, extra_events) = match outcome {
                crate::handoff::HandoffRejectOutcome::Ok {
                    ref packet,
                    ref upsert_event,
                    ref status_event,
                } => {
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Info,
                        serde_json::json!({
                            "event": "handoff.rejected",
                            "packet_id": packet.id,
                            "rejector": rejector,
                            "reason": reason,
                        }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        vec![upsert_event.clone(), status_event.clone()],
                    )
                }
                crate::handoff::HandoffRejectOutcome::Err {
                    ref code,
                    ref message,
                } => {
                    state.audit.log(
                        &cmd.session_id,
                        "handoff",
                        bridge_core::AuditSeverity::Warn,
                        serde_json::json!({
                            "event": "handoff.reject_failed",
                            "packet_id": packet_id,
                            "code": code,
                            "reason": message,
                        }),
                    );
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: code.clone(),
                                message: message.clone(),
                            }),
                        },
                        vec![],
                    )
                }
            };
            events.extend(extra_events);
            (ack, events)
        }
        "registry.sync" => dispatch_registry_sync(&cmd, &state).await,
        "registry.add" => dispatch_registry_add(&cmd, &state).await,
        "registry.reload" => dispatch_registry_reload(&cmd, &state).await,
        // Stage R4 — control-plane validation + reload. `config.validate`
        // is read-only: it returns the live snapshot's status without
        // re-reading any YAML. `config.reload` re-runs the loader; on
        // success the snapshot is swapped in atomically and the new
        // resume policy mirrored back into the hot-path Arc on AppState.
        "config.validate" => dispatch_config_validate(&cmd, &state).await,
        "config.reload" => dispatch_config_reload(&cmd, &state).await,
        _ => {
            // Forward to engine via session handle.
            let Some(handle) = state.sessions.get(&cmd.session_id) else {
                return (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: false,
                        error: Some(ErrorInfo {
                            code: "session.not_found".into(),
                            message: cmd.session_id.clone(),
                        }),
                    },
                    events,
                );
            };

            // Stage X.5c.1 — for ACP sessions, intercept
            // approval.approve / approval.reject and resolve the held
            // session/request_permission directly, bypassing the
            // agent's stdin (the agent never sees these commands —
            // it only sees the JSON-RPC response on its
            // request_permission call).
            if matches!(handle.agent_kind, crate::agent_runtime::AgentKind::Acp)
                && (cmd.cmd_type == "approval.approve" || cmd.cmd_type == "approval.reject")
            {
                let approval_id = match cmd
                    .payload
                    .get("approval_id")
                    .or_else(|| cmd.payload.get("approvalId"))
                    .and_then(|v| v.as_str())
                {
                    Some(s) => s.to_string(),
                    None => {
                        return (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: "protocol.bad_envelope".into(),
                                    message: "approval.* missing approval_id".into(),
                                }),
                            },
                            events,
                        );
                    }
                };
                let explicit_option_id = cmd
                    .payload
                    .get("option_id")
                    .or_else(|| cmd.payload.get("optionId"))
                    .and_then(|v| v.as_str());
                let result = if cmd.cmd_type == "approval.approve" {
                    handle
                        .resolve_approval_approve(&approval_id, explicit_option_id)
                        .await
                } else {
                    handle
                        .resolve_approval_reject(&approval_id, explicit_option_id)
                        .await
                };
                return match result {
                    Ok(resolution) => {
                        let outcome_label = if cmd.cmd_type == "approval.approve" {
                            "approved"
                        } else {
                            "rejected"
                        };
                        // Args hash over the canonical tool_call so the
                        // audit log can correlate this approval with
                        // the eventual tool_call_update without
                        // recording the raw payload twice.
                        // X.5c.2 alignment: hash excludes runtime-only
                        // top-level fields (toolCallId, status,
                        // rawOutput) so the X.5c.2 ObservedToolActivity
                        // `approval_tool_call_hash` joins this row by
                        // value even when the agent rotates the call id
                        // on subsequent updates.
                        let args_hash = sha256_hex_canonical_excluding(
                            &resolution.tool_call,
                            TOOL_CALL_HASH_DROP_FIELDS,
                        );
                        state.audit.log(
                            &cmd.session_id,
                            "approval",
                            AuditSeverity::Info,
                            json!({
                                "event": "resolved",
                                "approval_id": approval_id,
                                "option_id": resolution.option_id,
                                "outcome": outcome_label,
                                "agent_id": handle.agent_id,
                                "agent_kind": handle.agent_kind.as_str(),
                                "toolCallId": resolution.tool_call.get("toolCallId"),
                                "kind": resolution.tool_call.get("kind"),
                                "locations": resolution.tool_call.get("locations"),
                                "args_hash": args_hash,
                            }),
                        );
                        (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: true,
                                error: None,
                            },
                            events,
                        )
                    }
                    Err(e) => {
                        use crate::session::ApprovalResolveError as E;
                        let code = match &e {
                            E::NotAcp => "approval.not_acp",
                            E::NotFound(_) => "approval.not_found",
                            E::NoEligibleOption => "approval.option_not_found",
                            E::OptionNotFound(_) => "approval.option_not_found",
                            E::OptionKindMismatch { .. } => "approval.option_kind_mismatch",
                            E::OptionForbidden(_) => "approval.option_forbidden",
                            E::Transport(_) => "engine.unreachable",
                        };
                        state.audit.log(
                            &cmd.session_id,
                            "approval",
                            AuditSeverity::Warn,
                            json!({
                                "event": "resolve_failed",
                                "approval_id": approval_id,
                                "code": code,
                                "reason": e.to_string(),
                                "agent_id": handle.agent_id,
                                "agent_kind": handle.agent_kind.as_str(),
                            }),
                        );
                        (
                            ServerAck {
                                ack_of: cmd.id.clone(),
                                ok: false,
                                error: Some(ErrorInfo {
                                    code: code.into(),
                                    message: e.to_string(),
                                }),
                            },
                            events,
                        )
                    }
                };
            }

            // Stage X.3 — translate to the agent's wire dialect rather
            // than forwarding raw JSON-RPC. SessionHandle decides
            // (mock/vac-native: JSON-RPC; acp: ACP envelope) and
            // surfaces `agent.protocol_unsupported` for unmapped cmds.
            match handle.send_client_command(&cmd).await {
                Ok(()) => (
                    ServerAck {
                        ack_of: cmd.id.clone(),
                        ok: true,
                        error: None,
                    },
                    events,
                ),
                Err(e) => {
                    let msg = e.to_string();
                    let code = if msg.starts_with("agent.protocol_unsupported") {
                        "agent.protocol_unsupported"
                    } else {
                        "engine.unreachable"
                    };
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: false,
                            error: Some(ErrorInfo {
                                code: code.into(),
                                message: msg,
                            }),
                        },
                        events,
                    )
                }
            }
        }
    }
}

async fn emit_session_event_inner(handle: &SessionHandleRef, event: ServerEvent, persist: bool) {
    if persist {
        if let Some(sink) = handle.persistence.as_ref() {
            sink.record(&event);
        }
    }
    let seq = {
        let mut ring = handle.ring.write().await;
        ring.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = handle.broadcast.send(with_seq);
}

pub(crate) async fn emit_session_event(handle: &SessionHandleRef, event: ServerEvent) {
    emit_session_event_inner(handle, event, true).await;
}

pub(crate) async fn emit_session_event_live(handle: &SessionHandleRef, event: ServerEvent) {
    emit_session_event_inner(handle, event, false).await;
}

/// Stage X6 batch C1 — compare the persisted session's recorded
/// `mcp_servers` list with what the live agent runtime registry
/// currently advertises. Returns a `session.resume.warning` event
/// (reason `mcp_server_drift`) when they differ; otherwise `None`.
///
/// The comparison is intentionally semantic-equality on the JSON
/// values: the operator changing a server label, swapping order, or
/// adding/removing entries all surface as drift. Order changes are
/// considered drift because two MCP advertisements with the same
/// servers in a different order can resolve to different effective
/// tool sets when the agent picks the first match for a tool name.
///
/// Stage R3 — the policy at `state.resume_policy.mcp_server_drift`
/// chooses between `Warn` (today's behavior), `Fail` (hard reject),
/// and `Ignore` (suppress the event entirely). This keeps the runtime
/// the only enforcement point and lets operators flip the safety
/// posture from YAML.
#[derive(Debug)]
pub(crate) enum McpDriftAction {
    None,
    Warn(ServerEvent),
    Fail(ServerEvent),
}

fn build_mcp_drift_event(
    state: &AppStateHandle,
    meta: &crate::session::persistence::PersistedSessionMeta,
    target_id: &str,
    mode: &str,
) -> McpDriftAction {
    let registry = state.sessions.agents();
    let Ok(agent) = registry.get(&meta.agent_id) else {
        return McpDriftAction::None;
    };
    if meta.mcp_servers == agent.mcp_servers {
        return McpDriftAction::None;
    }
    use crate::config::McpDriftPolicy;
    let policy = state.resume_policy.mcp_server_drift;
    if matches!(policy, McpDriftPolicy::Ignore) {
        return McpDriftAction::None;
    }
    let severity = match policy {
        McpDriftPolicy::Fail => AuditSeverity::Error,
        _ => AuditSeverity::Warn,
    };
    state.audit.log(
        target_id,
        "session",
        severity,
        json!({
            "event": "resume_mcp_drift",
            "vac_session_id": target_id,
            "agent_id": meta.agent_id,
            "mode": mode,
            "policy": policy.as_str(),
            "persisted_count": meta.mcp_servers.len(),
            "live_count": agent.mcp_servers.len(),
        }),
    );
    let event_type = match policy {
        McpDriftPolicy::Fail => "session.resume.failed",
        _ => "session.resume.warning",
    };
    let event = ServerEvent {
        seq: 0,
        session_id: target_id.to_string(),
        event_type: event_type.into(),
        payload: json!({
            "vac_session_id": target_id,
            "reason": "mcp_server_drift",
            "mode": mode,
            "agent_id": meta.agent_id,
            "persisted": meta.mcp_servers.clone(),
            "live": agent.mcp_servers.clone(),
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    match policy {
        McpDriftPolicy::Fail => McpDriftAction::Fail(event),
        _ => McpDriftAction::Warn(event),
    }
}

/// Stage X6 4-5 — build a `session.replay.progress` event for the
/// FE chip. The bridge emits this:
///   * once with `replayed=0` immediately after `session.resume.started`
///     (so the chip transitions to `replaying` even on empty
///     transcripts), and
///   * once every `PROGRESS_TICK_EVERY` stored events, plus a final
///     terminal tick before `session.resumed` when the loop didn't
///     land on a bucket boundary.
///
/// Payload contract (matches `apps/web/src/domain/sessions/history.ts`):
/// ```text
/// { vac_session_id, mode, replayed }
/// ```
fn replay_progress_event(
    target_id: &str,
    mode_for_started: &'static str,
    replayed: usize,
    ts: &str,
) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: target_id.to_string(),
        event_type: "session.replay.progress".into(),
        payload: json!({
            "vac_session_id": target_id,
            "mode": mode_for_started,
            "replayed": replayed,
        }),
        v: 1,
        ts: ts.to_string(),
    }
}

/// Stage X6 batch 4-3 — shared persistence-replay path. Used by both
/// `replay_only` (direct) and `native_or_replay` (fallback) modes.
///
/// `mode_for_started` is the requested mode that drives the
/// `session.resume.started.mode` and audit `mode` field (e.g.
/// `"replay_only"` or `"native_or_replay"`).
/// `resume_mode_resolved` is what the FE state machine treats as the
/// final outcome (e.g. `"replay_only"` or `"replay_only_fallback"`).
async fn resume_persistence_replay(
    cmd: ClientCommand,
    state: AppStateHandle,
    persistence: crate::session::persistence::SharedPersistence,
    target_id: String,
    meta: crate::session::persistence::PersistedSessionMeta,
    mode_for_started: &'static str,
    resume_mode_resolved: &'static str,
    mut events: Vec<ServerEvent>,
) -> (ServerAck, Vec<ServerEvent>) {
    let stored = match persistence.load_events(&target_id, 0) {
        Ok(evs) => evs,
        Err(err) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "persistence.load_failed".into(),
                        message: err.to_string(),
                    }),
                },
                events,
            );
        }
    };
    let now = chrono::Utc::now().to_rfc3339();
    events.push(ServerEvent {
        seq: 0,
        session_id: target_id.clone(),
        event_type: "session.resume.started".into(),
        payload: json!({
            "vac_session_id": target_id,
            "mode": mode_for_started,
            "agent_id": meta.agent_id,
            "profile_id": meta.profile_id,
            "project_root": meta.project_root,
        }),
        v: 1,
        ts: now.clone(),
    });
    // Stage X6 4-5 — emit an initial `replayed=0` progress tick right
    // after `session.resume.started` so the FE chip can transition
    // immediately from `starting` → `replaying`, even when the
    // transcript is empty. Mirrors the contract documented on
    // `EffectiveResumeMode` in `apps/web/src/stores/sessionHistory.ts`.
    events.push(replay_progress_event(&target_id, mode_for_started, 0, &now));
    let replayed = stored.len();
    // Stage X6 4-5 — emit a `session.replay.progress` tick every Nth
    // stored event. 25 is small enough for snappy UX on small
    // histories (you'll see at least one tick after ~25 events) but
    // big enough that 1k-event sessions only fire ~40 ticks. The
    // terminal `replayed=N` tick is emitted unconditionally below so
    // the chip never stalls at a stale count.
    const PROGRESS_TICK_EVERY: usize = 25;
    let mut count: usize = 0;
    for ev in stored {
        events.push(ServerEvent {
            seq: ev.seq,
            session_id: target_id.clone(),
            event_type: ev.event_type,
            payload: ev.payload,
            v: 1,
            ts: ev.ts.to_rfc3339(),
        });
        count += 1;
        if count % PROGRESS_TICK_EVERY == 0 {
            events.push(replay_progress_event(
                &target_id,
                mode_for_started,
                count,
                &chrono::Utc::now().to_rfc3339(),
            ));
        }
    }
    // Final tick before `session.resumed` so the FE always sees the
    // exact replayed count (even when the loop didn't land on a
    // bucket boundary, or when the transcript was empty and the
    // initial 0-tick is the only one).
    if replayed > 0 && replayed % PROGRESS_TICK_EVERY != 0 {
        events.push(replay_progress_event(
            &target_id,
            mode_for_started,
            replayed,
            &chrono::Utc::now().to_rfc3339(),
        ));
    }
    events.push(ServerEvent {
        seq: 0,
        session_id: target_id.clone(),
        event_type: "session.resumed".into(),
        payload: json!({
            "vac_session_id": target_id,
            "mode": mode_for_started,
            "native": false,
            "resume_mode": resume_mode_resolved,
            "replayed_events": replayed,
        }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    });
    state.audit.log(
        &target_id,
        "session",
        AuditSeverity::Info,
        json!({
            "event": "resumed",
            "mode": mode_for_started,
            "resume_mode": resume_mode_resolved,
            "replayed": replayed,
        }),
    );
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: true,
            error: None,
        },
        events,
    )
}

fn build_executor_submit_command(
    executor_session_id: &str,
    packet: &crate::handoff::packet::Packet,
    source_session_id: &str,
) -> ClientCommand {
    ClientCommand {
        id: format!("cmd_{}", Ulid::new()),
        session_id: executor_session_id.to_string(),
        cmd_type: "message.submit".into(),
        payload: json!({
            "text": crate::handoff::build_executor_initial_prompt(packet),
            "handoff_packet_id": packet.id.clone(),
            "source_session_id": source_session_id,
        }),
        v: 1,
    }
}

fn parse_execution_outcome(payload: &serde_json::Value, fallback_status: &str) -> ExecutionOutcome {
    if let Some(outcome_value) = payload.get("outcome") {
        if let Ok(outcome) = serde_json::from_value::<ExecutionOutcome>(outcome_value.clone()) {
            return outcome;
        }
    }
    if let Ok(outcome) = serde_json::from_value::<ExecutionOutcome>(payload.clone()) {
        return outcome;
    }

    let fallback_status = fallback_status.trim();
    let status = if fallback_status.is_empty() {
        "success"
    } else {
        fallback_status
    };
    let summary = payload
        .get("error")
        .or_else(|| payload.get("reason"))
        .and_then(|v| v.as_str())
        .map(String::from);

    ExecutionOutcome {
        status: status.to_string(),
        tasks_completed: vec![],
        tasks_failed: vec![],
        changeset_summary: summary,
        reassessment_run_id: None,
    }
}

async fn relay_executor_event(
    state: &AppStateHandle,
    source_handle: &SessionHandleRef,
    packet_id: &str,
    executor_session_id: &str,
    event: ServerEvent,
) -> bool {
    let now = chrono::Utc::now();
    match event.event_type.as_str() {
        "handoff.execution_progress" | "handoff.dispatch_progress" => {
            let task_id = event
                .payload
                .get("task_id")
                .or_else(|| event.payload.get("current_task"))
                .or_else(|| event.payload.get("currentTask"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if task_id.trim().is_empty() {
                warn!(
                    packet_id = %packet_id,
                    event_type = %event.event_type,
                    "executor progress missing task_id"
                );
                return false;
            }
            let status = event
                .payload
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("started");
            let completed = event
                .payload
                .get("completed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let total = event
                .payload
                .get("total")
                .and_then(|v| v.as_u64())
                .unwrap_or(completed as u64) as u32;
            let message = event
                .payload
                .get("message")
                .or_else(|| event.payload.get("reason"))
                .and_then(|v| v.as_str())
                .map(String::from);

            match state.handoff.record_execution_progress(
                packet_id,
                TaskExecutionProgress {
                    task_id: task_id.to_string(),
                    status: status.to_string(),
                    updated_at: now.to_rfc3339(),
                    completed,
                    total,
                    message,
                },
                executor_session_id,
                &source_handle.id,
                now,
            ) {
                crate::handoff::HandoffExecutionProgressOutcome::Ok {
                    upsert_event,
                    progress_event,
                    ..
                } => {
                    emit_session_event(source_handle, upsert_event).await;
                    emit_session_event(source_handle, progress_event).await;
                }
                crate::handoff::HandoffExecutionProgressOutcome::Err { code, message } => {
                    warn!(
                        packet_id = %packet_id,
                        event_type = %event.event_type,
                        %code,
                        %message,
                        "executor progress ignored"
                    );
                }
            }
            false
        }
        "handoff.status" => {
            let status = event
                .payload
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match status {
                "completed" | "failed" => {
                    let outcome = parse_execution_outcome(
                        &event.payload,
                        if status == "failed" {
                            "failed"
                        } else {
                            "success"
                        },
                    );
                    match state.handoff.complete_execution(
                        packet_id,
                        executor_session_id,
                        outcome,
                        &source_handle.id,
                        now,
                    ) {
                        crate::handoff::HandoffExecutionCompleteOutcome::Ok {
                            upsert_event,
                            status_event,
                            terminal_event,
                            ..
                        } => {
                            emit_session_event(source_handle, upsert_event).await;
                            emit_session_event(source_handle, status_event).await;
                            emit_session_event(source_handle, terminal_event).await;
                        }
                        crate::handoff::HandoffExecutionCompleteOutcome::Err { code, message } => {
                            warn!(
                                packet_id = %packet_id,
                                event_type = %event.event_type,
                                %code,
                                %message,
                                "executor terminal state ignored"
                            );
                        }
                    }
                    true
                }
                _ => false,
            }
        }
        "handoff.completed" | "handoff.failed" => {
            let outcome = parse_execution_outcome(
                &event.payload,
                if event.event_type == "handoff.failed" {
                    "failed"
                } else {
                    "success"
                },
            );
            match state.handoff.complete_execution(
                packet_id,
                executor_session_id,
                outcome,
                &source_handle.id,
                now,
            ) {
                crate::handoff::HandoffExecutionCompleteOutcome::Ok {
                    upsert_event,
                    status_event,
                    terminal_event,
                    ..
                } => {
                    emit_session_event(source_handle, upsert_event).await;
                    emit_session_event(source_handle, status_event).await;
                    emit_session_event(source_handle, terminal_event).await;
                }
                crate::handoff::HandoffExecutionCompleteOutcome::Err { code, message } => {
                    warn!(
                        packet_id = %packet_id,
                        event_type = %event.event_type,
                        %code,
                        %message,
                        "executor terminal event ignored"
                    );
                }
            }
            true
        }
        "transcript.completed" => {
            let outcome = parse_execution_outcome(&event.payload, "success");
            match state.handoff.complete_execution(
                packet_id,
                executor_session_id,
                outcome,
                &source_handle.id,
                now,
            ) {
                crate::handoff::HandoffExecutionCompleteOutcome::Ok {
                    upsert_event,
                    status_event,
                    terminal_event,
                    ..
                } => {
                    emit_session_event(source_handle, upsert_event).await;
                    emit_session_event(source_handle, status_event).await;
                    emit_session_event(source_handle, terminal_event).await;
                }
                crate::handoff::HandoffExecutionCompleteOutcome::Err { code, message } => {
                    warn!(
                        packet_id = %packet_id,
                        event_type = %event.event_type,
                        %code,
                        %message,
                        "transcript completion ignored"
                    );
                }
            }
            true
        }
        "transcript.error" => {
            let outcome = parse_execution_outcome(&event.payload, "failed");
            match state.handoff.complete_execution(
                packet_id,
                executor_session_id,
                outcome,
                &source_handle.id,
                now,
            ) {
                crate::handoff::HandoffExecutionCompleteOutcome::Ok {
                    upsert_event,
                    status_event,
                    terminal_event,
                    ..
                } => {
                    emit_session_event(source_handle, upsert_event).await;
                    emit_session_event(source_handle, status_event).await;
                    emit_session_event(source_handle, terminal_event).await;
                }
                crate::handoff::HandoffExecutionCompleteOutcome::Err { code, message } => {
                    warn!(
                        packet_id = %packet_id,
                        event_type = %event.event_type,
                        %code,
                        %message,
                        "transcript error ignored"
                    );
                }
            }
            true
        }
        _ => false,
    }
}

/// Sprint 5 — fetch the configured remote / on-disk registry and return
/// the merged catalog as a `registry.synced` event.
///
/// The command is sessionless; `cmd.session_id` is ignored. Errors are
/// surfaced via `ServerAck { ok: false, error: … }` with codes:
/// - `registry.not_configured` — no `[registry]` table in agents.toml.
/// - `registry.fetch_failed` — HTTP / file IO / parse failure.
async fn dispatch_registry_sync(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let registry = state.sessions.agents();
    let Some(source) = registry.registry_source() else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "registry.not_configured".into(),
                    message: "agents.toml has no [registry] table".into(),
                }),
            },
            vec![],
        );
    };

    // Audit P2 fix: enforce optional `trusted_url_prefixes` allowlist
    // before fetching. URL-kind sources outside the allowlist return
    // `registry.trust_violation`; path-kind sources are unaffected
    // (they're already on disk and don't pull from the network).
    if let crate::agent_runtime::config::RegistrySourceKind::Url(u) = &source.kind {
        if !source.trusted_url_prefixes.is_empty()
            && !source
                .trusted_url_prefixes
                .iter()
                .any(|prefix| u.starts_with(prefix))
        {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "registry.trust_violation".into(),
                        message: format!(
                            "registry URL `{u}` is not covered by trusted_url_prefixes"
                        ),
                    }),
                },
                vec![],
            );
        }
    }

    // Cache next to the loaded agents.toml when we have one; otherwise
    // skip caching (embedded default has no on-disk home).
    let cache_dir = registry
        .source_path()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    let result =
        crate::agent_runtime::sync_registry(source, registry.as_ref(), cache_dir.as_deref()).await;
    match result {
        Ok(snap) => {
            let payload = json!({
                "source": snap.source,
                "sourceKind": snap.source_kind,
                "fromCache": snap.from_cache,
                "agents": snap.entries,
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                vec![ServerEvent {
                    seq: 0,
                    session_id: String::new(),
                    event_type: "registry.synced".into(),
                    payload,
                    v: 1,
                    ts: chrono::Utc::now().to_rfc3339(),
                }],
            )
        }
        Err(err) => (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "registry.fetch_failed".into(),
                    message: format!("{err:#}"),
                }),
            },
            vec![],
        ),
    }
}

/// Sprint 5 — append a remote agent entry to the local agents.toml.
///
/// Payload shape: `{ id, label, kind, command, args?, install_hint? }`.
/// All identity fields are required and validated (kind must be `mock` /
/// `vac-native` / `acp`). Idempotent on `id` collision: returns
/// `ok: true` with `payload.added = false` when the entry already
/// exists locally.
async fn dispatch_registry_add(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let registry = state.sessions.agents();
    let Some(target) = registry.source_path().map(|p| p.to_path_buf()) else {
        return (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "registry.no_local_config".into(),
                    message: "bridge is running with the embedded default config; cannot append"
                        .into(),
                }),
            },
            vec![],
        );
    };

    let entry: crate::agent_runtime::RegistryEntry = match parse_registry_add_payload(&cmd.payload)
    {
        Ok(e) => e,
        Err(msg) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "registry.invalid_payload".into(),
                        message: msg,
                    }),
                },
                vec![],
            );
        }
    };

    // We need a fresh AgentsConfig snapshot (not a mutable view of the
    // running registry) to validate the merge before touching disk.
    let snapshot = match std::fs::read_to_string(&target)
        .map_err(anyhow::Error::from)
        .and_then(|raw| {
            crate::agent_runtime::AgentsConfig::from_toml_str(&raw, &target)
                .map_err(anyhow::Error::from)
        }) {
        Ok(c) => c,
        Err(err) => {
            return (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "registry.config_read_failed".into(),
                        message: format!("{err:#}"),
                    }),
                },
                vec![],
            );
        }
    };

    match crate::agent_runtime::append_agent_to_config(&target, &entry, &snapshot) {
        Ok(added) => {
            let payload = json!({
                "id": entry.id,
                "added": added,
                "path": target.display().to_string(),
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                vec![ServerEvent {
                    seq: 0,
                    session_id: String::new(),
                    event_type: "registry.added".into(),
                    payload,
                    v: 1,
                    ts: chrono::Utc::now().to_rfc3339(),
                }],
            )
        }
        Err(err) => (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "registry.append_failed".into(),
                    message: format!("{err:#}"),
                }),
            },
            vec![],
        ),
    }
}

/// Audit P3 — re-read `agents.toml` from the same source the bridge
/// originally loaded and atomically swap it in. New `session.create`
/// calls see the fresh registry on the very next dispatch; in-flight
/// sessions keep the snapshot they captured. Errors:
/// - `registry.reload_failed` — load() / parse failure (the previous
///   registry stays installed).
async fn dispatch_registry_reload(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    match state.sessions.reload_agents() {
        Ok(fresh) => {
            let agents: Vec<serde_json::Value> = fresh
                .list_enabled()
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id,
                        "label": a.label,
                        "kind": a.kind.as_str(),
                    })
                })
                .collect();
            let payload = json!({
                "source": fresh.source().describe(),
                "defaultAgentId": fresh.default_agent().id,
                "agents": agents,
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                vec![ServerEvent {
                    seq: 0,
                    session_id: String::new(),
                    event_type: "registry.reloaded".into(),
                    payload,
                    v: 1,
                    ts: chrono::Utc::now().to_rfc3339(),
                }],
            )
        }
        Err(err) => (
            ServerAck {
                ack_of: cmd.id.clone(),
                ok: false,
                error: Some(ErrorInfo {
                    code: "registry.reload_failed".into(),
                    message: format!("{err:#}"),
                }),
            },
            vec![],
        ),
    }
}

/// Build the `payload` object that `config.validated` /
/// `config.reloaded` events ship to the FE. Mirrors the resume
/// policy block from `config.policy.get` so the FE store can use
/// the same reducer for both event types, and adds preview
/// summaries for agents + MCP plus any non-fatal diagnostics.
fn config_snapshot_payload(snap: &crate::config::ConfigSnapshot) -> serde_json::Value {
    let p = &snap.resume_policy;
    json!({
        "scope": "config",
        "ok": snap.ok,
        "loaded_at": snap.loaded_at,
        "vac_version": snap.vac_version,
        "policy": {
            "default_mode": p.default_mode.as_str(),
            "native_fallback": p.native_fallback.as_str(),
            "mcp_server_drift": p.mcp_server_drift.as_str(),
            "profile_class_mismatch": p.profile_class_mismatch.as_str(),
            "retention_days": p.retention_days,
            "max_events": p.max_events,
        },
        "agents": {
            "version": snap.agents.version,
            "count": snap.agents.count,
            "default_id": snap.agents.default_id,
            "items": snap.agents.agents,
        },
        "mcp": {
            "version": snap.mcp.version,
            "count": snap.mcp.count,
            "servers": snap.mcp.servers,
        },
        "diagnostics": snap.diagnostics,
        "active_snapshot_retained": snap.active_snapshot_retained,
        "last_reload_failed_at": snap.last_reload_failed_at,
    })
}

/// `config.validate` — read-only echo of the live snapshot. Useful
/// before flipping a reload button on the FE so the operator can
/// see what's currently active without triggering a re-read.
async fn dispatch_config_validate(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let snap = state.config_snapshot.read().await;
    let event_type = if snap.ok {
        "config.validated"
    } else {
        "config.validate.failed"
    };
    let payload = config_snapshot_payload(&snap);
    (
        ServerAck {
            ack_of: cmd.id.clone(),
            ok: snap.ok,
            error: if snap.ok {
                None
            } else {
                Some(ErrorInfo {
                    code: "config.invalid".into(),
                    message: "active config snapshot has unresolved errors".into(),
                })
            },
        },
        vec![ServerEvent {
            seq: 0,
            session_id: cmd.session_id.clone(),
            event_type: event_type.into(),
            payload,
            v: 1,
            ts: chrono::Utc::now().to_rfc3339(),
        }],
    )
}

/// `config.reload` — re-run the loader against the same
/// `LoaderPaths` we booted with. On success: swap the snapshot
/// atomically and emit `config.reloaded` so every FE client
/// updates its preview. On failure: keep the previous snapshot
/// installed and emit `config.reload_failed` with the diagnostic
/// list. The hot-path `state.resume_policy` Arc is *not* swapped
/// here — that keeps resume enforcement byte-stable across a
/// reload; an operator who needs new resume rules to take effect
/// at runtime restarts the bridge. The snapshot's resume policy
/// is still updated so the FE preview reflects the new YAML.
async fn dispatch_config_reload(
    cmd: &ClientCommand,
    state: &AppStateHandle,
) -> (ServerAck, Vec<ServerEvent>) {
    let started = ServerEvent {
        seq: 0,
        session_id: cmd.session_id.clone(),
        event_type: "config.reload.started".into(),
        payload: json!({ "scope": "config" }),
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
    };
    let paths = crate::config::LoaderPaths::from_env_or(std::path::PathBuf::from("config"));
    match crate::config::loader::load(&paths) {
        crate::config::LoadOutcome::Loaded(snap) => {
            let payload = config_snapshot_payload(&snap);
            {
                let mut guard = state.config_snapshot.write().await;
                *guard = snap;
            }
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: true,
                    error: None,
                },
                vec![
                    started,
                    ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "config.reloaded".into(),
                        payload,
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    },
                ],
            )
        }
        crate::config::LoadOutcome::Failed(diags) => {
            // Mark the live snapshot as not-ok so future
            // `config.validate` calls reflect the failed state, but
            // keep the previous policy + summaries — operators still
            // need a working bridge while they fix the YAML.
            let failed_at = chrono::Utc::now().to_rfc3339();
            let last_successful_loaded_at = {
                let mut guard = state.config_snapshot.write().await;
                guard.ok = false;
                guard.diagnostics = diags.clone();
                guard.active_snapshot_retained = true;
                guard.last_reload_failed_at = Some(failed_at.clone());
                guard.loaded_at.clone()
            };
            let payload = json!({
                "scope": "config",
                "ok": false,
                "diagnostics": diags,
                "active_snapshot_retained": true,
                "last_reload_failed_at": failed_at,
                "last_successful_loaded_at": last_successful_loaded_at,
            });
            (
                ServerAck {
                    ack_of: cmd.id.clone(),
                    ok: false,
                    error: Some(ErrorInfo {
                        code: "config.reload_failed".into(),
                        message: "config reload failed; previous snapshot retained".into(),
                    }),
                },
                vec![
                    started,
                    ServerEvent {
                        seq: 0,
                        session_id: cmd.session_id.clone(),
                        event_type: "config.reload_failed".into(),
                        payload,
                        v: 1,
                        ts: chrono::Utc::now().to_rfc3339(),
                    },
                ],
            )
        }
    }
}

fn parse_registry_add_payload(
    payload: &serde_json::Value,
) -> Result<crate::agent_runtime::RegistryEntry, String> {
    let obj = payload
        .as_object()
        .ok_or_else(|| "payload must be an object".to_string())?;
    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing id".to_string())?
        .trim()
        .to_string();
    if id.is_empty() {
        return Err("id must be non-empty".into());
    }
    let kind = obj
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing kind".to_string())?
        .to_string();
    if !matches!(kind.as_str(), "mock" | "vac-native" | "acp") {
        return Err(format!("unsupported kind '{kind}'"));
    }
    let command = obj
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing command".to_string())?
        .to_string();
    if command.trim().is_empty() {
        return Err("command must be non-empty".into());
    }
    let label = obj
        .get("label")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| id.clone());
    let args = obj
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let install_hint = obj
        .get("install_hint")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(crate::agent_runtime::RegistryEntry {
        id,
        label,
        kind,
        command,
        args,
        install_hint,
        source: crate::agent_runtime::RegistryEntrySource::Remote,
        installed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handoff::packet::{
        HandoffApproval, HandoffConnectorSnapshot, HandoffPin, HandoffTarget, Packet, PacketStatus,
        PacketTask, PinPolicy,
    };
    use serde_json::json;

    fn sample_packet() -> Packet {
        let now = "2026-04-24T10:00:00Z".to_string();
        Packet {
            id: "pkt_01JTEST000000000001".into(),
            title: "Fix handoff dispatch".into(),
            summary: Some("Make execution provider-agnostic".into()),
            source_run_ids: vec!["run_01JTEST000000000002".into()],
            accepted_finding_ids: vec!["finding_1".into()],
            created_by: "author".into(),
            created_at: now.clone(),
            pin: HandoffPin {
                repo_ref: "branch:main".into(),
                base_commit_sha: "a".repeat(40),
                worktree_digest: "b".repeat(64),
                assessment_snapshot_at: now.clone(),
                connector_snapshots: vec![HandoffConnectorSnapshot {
                    connector_id: "github_default".into(),
                    kind: "github".into(),
                    snapshot_id: "snap_1".into(),
                    captured_at: now.clone(),
                    etag: None,
                }],
                expires_at: "2026-05-01T10:30:00Z".into(),
                invalidate_on_repo_change: false,
                invalidation_policy: PinPolicy::Strict,
            },
            tasks: vec![PacketTask {
                id: "task_1".into(),
                title: "Update the handoff state".into(),
                rationale: "exercise the execution loop".into(),
                source_finding_ids: vec!["finding_1".into()],
                evidence_refs: vec![json!({ "uri": "file:///README.md" })],
                steps: vec!["Inspect the packet".into(), "Apply the fix".into()],
                constraints: vec!["Stay within scope".into()],
                risk_notes: vec![],
                est_effort: None,
                depends_on: vec![],
                touches_paths: vec!["apps/web/src/**".into()],
                requires_approval_per_step: false,
                rollback_steps: vec!["Revert the last commit".into()],
            }],
            order_hint: None,
            target: HandoffTarget {
                kind: "dispatch_to_local_vac".into(),
                executor_profile_id: "executor.code@1.0.0".into(),
                session_title: Some("Executor".into()),
            },
            approval: HandoffApproval {
                required: true,
                approvers: vec![],
                approver_notes: None,
                approved_at: None,
                two_party: false,
                required_roles: vec![],
            },
            status: PacketStatus::Approved,
            state_history: vec![],
            signers: vec![],
            required_signers: 0,
            execution_session_id: None,
            execution_progress: None,
            execution_outcome: None,
            convergence_count: 0,
            updated_at: now,
        }
    }

    #[test]
    fn handoff_dispatch_to_acp_uses_message_submit_not_handoff_dispatch_local() {
        let packet = sample_packet();
        let cmd = build_executor_submit_command("sess_executor", &packet, "sess_source");

        assert_eq!(cmd.cmd_type, "message.submit");
        assert_eq!(cmd.session_id, "sess_executor");
        assert_eq!(
            cmd.payload["handoff_packet_id"],
            json!("pkt_01JTEST000000000001")
        );
        assert_eq!(cmd.payload["source_session_id"], json!("sess_source"));
        let prompt = cmd.payload["text"].as_str().expect("prompt text");
        assert!(prompt.contains("VAC Web Handoff Packet"));
        assert!(prompt.contains("Packet: pkt_01JTEST000000000001"));
    }

    #[test]
    fn executor_dispatch_payload_contains_structured_handoff_prompt() {
        let packet = sample_packet();
        let prompt = crate::handoff::build_executor_initial_prompt(&packet);

        assert!(prompt.contains("VAC Web Handoff Packet"));
        assert!(prompt.contains("Title: Fix handoff dispatch"));
        assert!(prompt.contains("Pinned repo: branch:main @ "));
        assert!(prompt.contains("Rules:"));
        assert!(prompt.contains("Tasks:"));
        assert!(prompt.contains("Evidence refs:"));
        assert!(prompt.contains("Touches paths:"));
        assert!(prompt.contains("Rollback:"));
    }
}
