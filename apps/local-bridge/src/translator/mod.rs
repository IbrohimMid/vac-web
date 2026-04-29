//! Command dispatch (WS client → session) + envelope translation.

use crate::agent_runtime::acp::{sha256_hex_canonical_excluding, TOOL_CALL_HASH_DROP_FIELDS};
use crate::audit::log_tool_event;
use crate::handoff::packet::{ExecutionOutcome, TaskExecutionProgress};
use crate::profile_layer::{enforce_action, EnforceOutcome};
use crate::server::AppStateHandle;
use crate::session::{AuthenticateError, SessionHandleRef};
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use bridge_core::{AuditSeverity, ReplayResult};
use profile_core::{enforce::enforce_agent_kind, profile::CapabilityProfile, Decision};
use serde_json::json;
use std::sync::Arc;
use tracing::warn;
use ulid::Ulid;

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
        "session.resume" => {
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

async fn emit_session_event(handle: &SessionHandleRef, event: ServerEvent) {
    let seq = {
        let mut ring = handle.ring.write().await;
        ring.push(event.clone())
    };
    let mut with_seq = event;
    with_seq.seq = seq;
    let _ = handle.broadcast.send(with_seq);
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
    let result = crate::agent_runtime::sync_registry(source, registry, cache_dir.as_deref()).await;
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
