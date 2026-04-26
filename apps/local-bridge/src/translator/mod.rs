//! Command dispatch (WS client → session) + envelope translation.

use crate::agent_runtime::acp::sha256_hex_canonical;
use crate::audit::log_tool_event;
use crate::profile_layer::{enforce_action, EnforceOutcome};
use crate::server::AppStateHandle;
use crate::ws::envelope::{ClientCommand, ErrorInfo, ServerAck, ServerEvent};
use bridge_core::AuditSeverity;
use profile_core::{enforce::enforce_agent_kind, profile::CapabilityProfile, Decision};
use serde_json::json;
use tracing::warn;

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

            match state
                .sessions
                .create_with_agent(
                    profile_id.clone(),
                    project_root.clone(),
                    requested_agent_id.as_deref(),
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
                        }),
                    );
                    let now = chrono::Utc::now().to_rfc3339();
                    use crate::notify::{
                        activity_event, notify_event, system_pulse_event, Lane, Severity,
                    };
                    (
                        ServerAck {
                            ack_of: cmd.id.clone(),
                            ok: true,
                            error: None,
                        },
                        vec![
                            ServerEvent {
                                seq: 0,
                                session_id: handle.id.clone(),
                                event_type: "session.ready".into(),
                                // Stage X.4 — emit agent_id + agent_kind so
                                // web clients can render which runtime is
                                // backing the session and lock UI affordances
                                // accordingly. Pre-X.4 fields preserved.
                                payload: json!({
                                    "session_id": handle.id,
                                    "profile_id": handle.profile_id,
                                    "agent_id": handle.agent_id,
                                    "agent_kind": handle.agent_kind.as_str(),
                                }),
                                v: 1,
                                ts: now.clone(),
                            },
                            ServerEvent {
                                seq: 0,
                                session_id: handle.id.clone(),
                                event_type: "system.capabilities".into(),
                                payload: crate::capabilities::capabilities_payload(),
                                v: 1,
                                ts: now.clone(),
                            },
                            notify_event(
                                handle.id.clone(),
                                Lane::Transient,
                                Severity::Ok,
                                "session",
                                "Session ready",
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
                                &format!("Session created with {}", handle.profile_id),
                            ),
                        ],
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
                        let args_hash = sha256_hex_canonical(&resolution.tool_call);
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
