//! Handoff subsystem: pin computation, packet registry, and dispatch guard.
//!
//! Architecture: local-bridge is the authority for handoff pin computation,
//! packet registry, and dispatch authorization. The runtime provider (mock-engine
//! or vac-native) handles execution after the bridge has approved a packet.
//!
//! This module does NOT handle approval flow — that is handled by the runtime
//! provider and the frontend's `handoff.approve` handler. The bridge only guards
//! dispatch.

pub mod packet;
pub mod pin;
pub mod registry;
pub mod validate;

use crate::ws::envelope::ServerEvent;
use packet::{Packet, PacketStatus, PinPolicy};
use pin::compute_pin;
use registry::HandoffRegistry;
use serde_json::json;
use ulid::Ulid;
use validate::validate_handoff_create;

pub struct HandoffService {
    pub registry: HandoffRegistry,
}

impl Default for HandoffService {
    fn default() -> Self {
        Self::new()
    }
}

impl HandoffService {
    pub fn new() -> Self {
        Self {
            registry: HandoffRegistry::new(),
        }
    }
}

pub struct HandoffCreateParams<'a> {
    pub payload: &'a serde_json::Value,
    pub project_root: &'a std::path::Path,
    pub session_id: &'a str,
    pub author: &'a str,
    pub now: chrono::DateTime<chrono::Utc>,
}

#[allow(clippy::large_enum_variant)]
pub enum HandoffCreateOutcome {
    Ok {
        packet: Packet,
        upsert_event: ServerEvent,
    },
    Err {
        code: String,
        message: String,
    },
}

impl HandoffService {
    pub fn create_handoff(&self, params: HandoffCreateParams<'_>) -> HandoffCreateOutcome {
        let payload = params.payload;

        if let Err(errors) = validate_handoff_create(payload) {
            let first = errors.first();
            return HandoffCreateOutcome::Err {
                code: first
                    .map(|e| e.code)
                    .unwrap_or("handoff.invalid_payload")
                    .to_string(),
                message: errors
                    .iter()
                    .map(|e| e.message.clone())
                    .collect::<Vec<_>>()
                    .join("; "),
            };
        }

        let pin_policy = payload
            .get("pin")
            .and_then(|p| {
                p.get("invalidation_policy")
                    .or_else(|| p.get("invalidationPolicy"))
                    .or_else(|| p.get("policy"))
            })
            .and_then(|v| v.as_str())
            .map(PinPolicy::from_str)
            .unwrap_or(PinPolicy::Strict);

        let connector_snapshots = payload
            .get("pin")
            .and_then(|p| p.get("connector_snapshots"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| {
                        Some(packet::HandoffConnectorSnapshot {
                            connector_id: s
                                .get("connector_id")
                                .and_then(|v| v.as_str())?
                                .to_string(),
                            kind: s
                                .get("kind")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string(),
                            snapshot_id: s.get("snapshot_id").and_then(|v| v.as_str())?.to_string(),
                            captured_at: s
                                .get("captured_at")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&params.now.to_rfc3339())
                                .to_string(),
                            etag: s.get("etag").and_then(|v| v.as_str()).map(String::from),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let pin = compute_pin(pin::PinComputeOptions {
            project_root: params.project_root,
            repo_ref: payload
                .get("pin")
                .and_then(|p| p.get("repo_ref").or_else(|| p.get("repoRef")))
                .and_then(|v| v.as_str())
                .map(String::from),
            base_commit_sha: payload
                .get("pin")
                .and_then(|p| {
                    p.get("base_commit_sha")
                        .or_else(|| p.get("baseCommitSha"))
                        .or_else(|| p.get("base_sha"))
                })
                .and_then(|v| v.as_str())
                .map(String::from),
            assessment_snapshot_at: payload
                .get("pin")
                .and_then(|p| {
                    p.get("assessment_snapshot_at")
                        .or_else(|| p.get("assessmentSnapshotAt"))
                        .or_else(|| p.get("captured_at"))
                })
                .and_then(|v| v.as_str())
                .map(String::from),
            connector_snapshots,
            invalidation_policy: pin_policy,
            now: params.now,
        });

        let title = payload
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Handoff")
            .to_string();
        let summary = payload
            .get("summary")
            .and_then(|v| v.as_str())
            .map(String::from);
        let source_run_ids: Vec<String> = payload
            .get("source_run_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let accepted_finding_ids: Vec<String> = payload
            .get("accepted_finding_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let tasks: Vec<packet::PacketTask> = payload
            .get("tasks")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|t| packet::PacketTask {
                        id: t
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("task")
                            .to_string(),
                        title: t
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Task")
                            .to_string(),
                        rationale: t
                            .get("rationale")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        source_finding_ids: t
                            .get("source_finding_ids")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        evidence_refs: t
                            .get("evidence_refs")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default(),
                        steps: t
                            .get("steps")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        constraints: t
                            .get("constraints")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        risk_notes: t
                            .get("risk_notes")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        est_effort: t
                            .get("est_effort")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        depends_on: t
                            .get("depends_on")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        touches_paths: t
                            .get("touches_paths")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        requires_approval_per_step: t
                            .get("requires_approval_per_step")
                            .or_else(|| t.get("requiresApprovalPerStep"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                        rollback_steps: t
                            .get("rollback_steps")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let order_hint = tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>();
        let order_hint_nonempty = if order_hint.is_empty() {
            None
        } else {
            Some(order_hint)
        };

        let target = packet::HandoffTarget {
            kind: payload
                .get("target")
                .and_then(|t| t.get("kind").and_then(|v| v.as_str()))
                .unwrap_or("dispatch_to_local_vac")
                .to_string(),
            executor_profile_id: payload
                .get("target")
                .and_then(|t| {
                    t.get("executor_profile_id")
                        .or_else(|| t.get("executorProfileId"))
                        .or_else(|| t.get("profile_id"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            session_title: payload
                .get("target")
                .and_then(|t| t.get("session_title").or_else(|| t.get("sessionTitle")))
                .and_then(|v| v.as_str())
                .map(String::from),
        };

        let two_party = tasks.iter().any(|t| t.requires_approval_per_step)
            || target.executor_profile_id.starts_with("executor.release@");

        let now_ts = params.now.to_rfc3339();
        let packet = Packet {
            id: format!("pkt_{}", Ulid::new()),
            title,
            summary,
            source_run_ids,
            accepted_finding_ids,
            created_by: params.author.to_string(),
            created_at: now_ts.clone(),
            pin,
            tasks,
            order_hint: order_hint_nonempty,
            target,
            approval: packet::HandoffApproval {
                required: true,
                approvers: vec![],
                approver_notes: None,
                approved_at: None,
                two_party,
                required_roles: if two_party {
                    vec!["approver".to_string()]
                } else {
                    vec![]
                },
            },
            status: PacketStatus::PendingApproval,
            state_history: vec![packet::PacketStateHistoryEntry {
                state: "draft".to_string(),
                at: now_ts.clone(),
                by: Some(params.author.to_string()),
                reason: None,
            }],
            signers: vec![packet::Signer {
                name: params.author.to_string(),
                role: "author".to_string(),
                signed_at: now_ts.clone(),
                reason: None,
            }],
            required_signers: if two_party { 2 } else { 1 },
            execution_session_id: None,
            execution_outcome: None,
            convergence_count: 0,
            updated_at: now_ts,
        };

        let pin_payload = serde_json::to_value(&packet.pin).unwrap_or(serde_json::Value::Null);
        let tasks_payload = serde_json::to_value(&packet.tasks).unwrap_or(serde_json::Value::Null);
        let target_payload =
            serde_json::to_value(&packet.target).unwrap_or(serde_json::Value::Null);
        let approval_payload =
            serde_json::to_value(&packet.approval).unwrap_or(serde_json::Value::Null);
        let signers_payload =
            serde_json::to_value(&packet.signers).unwrap_or(serde_json::Value::Null);
        let state_history_payload =
            serde_json::to_value(&packet.state_history).unwrap_or(serde_json::Value::Null);

        let upsert_payload = json!({
            "packet_id": packet.id,
            "title": packet.title,
            "summary": packet.summary,
            "source_run_ids": packet.source_run_ids,
            "accepted_finding_ids": packet.accepted_finding_ids,
            "created_by": packet.created_by,
            "created_at": packet.created_at,
            "pin": {
                "repo_ref": pin_payload.get("repo_ref"),
                "base_commit_sha": pin_payload.get("base_commit_sha"),
                "worktree_digest": pin_payload.get("worktree_digest"),
                "assessment_snapshot_at": pin_payload.get("assessment_snapshot_at"),
                "connector_snapshots": pin_payload.get("connector_snapshots"),
                "expires_at": pin_payload.get("expires_at"),
                "invalidate_on_repo_change": pin_payload.get("invalidate_on_repo_change"),
                "invalidation_policy": pin_payload.get("invalidation_policy"),
                "base_sha": pin_payload.get("base_commit_sha"),
                "captured_at": pin_payload.get("assessment_snapshot_at"),
                "policy": pin_payload.get("invalidation_policy"),
            },
            "tasks": tasks_payload,
            "order_hint": packet.order_hint,
            "target": target_payload,
            "approval": approval_payload,
            "status": packet.status.as_str(),
            "signers": signers_payload,
            "required_signers": packet.required_signers,
            "state_history": state_history_payload,
            "convergence_count": 0,
            "updated_at": packet.updated_at,
        });

        let upsert_event = ServerEvent {
            seq: 0,
            session_id: params.session_id.to_string(),
            event_type: "handoff.upserted".into(),
            payload: upsert_payload,
            v: 1,
            ts: params.now.to_rfc3339(),
        };

        self.registry.insert(packet.clone());
        HandoffCreateOutcome::Ok {
            packet,
            upsert_event,
        }
    }

    pub fn check_dispatch(&self, packet_id: &str) -> Result<Packet, DispatchError> {
        let packet = self
            .registry
            .get(packet_id)
            .ok_or(DispatchError::NotFound)?;
        if packet.status != PacketStatus::Approved {
            return Err(DispatchError::NotApproved);
        }
        if !packet.pin.is_complete() {
            return Err(DispatchError::PinIncomplete);
        }
        if packet.pin.is_expired() {
            return Err(DispatchError::PinExpired);
        }
        Ok(packet)
    }
}

#[derive(Debug)]
pub enum DispatchError {
    NotFound,
    NotApproved,
    PinIncomplete,
    PinExpired,
}

impl DispatchError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "handoff.not_found",
            Self::NotApproved => "handoff.not_approved",
            Self::PinIncomplete => "handoff.pin_incomplete",
            Self::PinExpired => "handoff.pin_expired",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::NotFound => "packet not found".to_string(),
            Self::NotApproved => "packet must be approved before dispatch".to_string(),
            Self::PinIncomplete => "pin is incomplete".to_string(),
            Self::PinExpired => "pin has expired".to_string(),
        }
    }
}
