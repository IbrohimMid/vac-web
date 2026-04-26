//! Handoff subsystem: pin computation, packet registry, approval state, and dispatch guard.
//!
//! Architecture: local-bridge is the authority for handoff pin computation,
//! packet registry, approval state transitions, and dispatch authorization.
//! The runtime provider (mock-engine or vac-native) handles execution after
//! the bridge has approved a packet and verified the pin has not drifted.
//!
//! Approval flow (bridge-owned):
//!   `handoff.approve` → enforces self-sign deny, adds a signer, flips status
//!   to `Approved` once `signers.len() >= required_signers`.
//!   `handoff.reject` → flips status to `Rejected`.
//!
//! Dispatch guard:
//!   `check_dispatch` recomputes the current pin from `project_root` and
//!   rejects with `handoff.pin_drift` when `invalidation_policy == Strict`
//!   and any of `repo_ref`, `base_commit_sha`, or `worktree_digest` differs.

pub mod packet;
pub mod pin;
pub mod registry;
pub mod validate;

use crate::ws::envelope::ServerEvent;
use chrono::{DateTime, Utc};
use packet::{
    canonical_signer_id, Packet, PacketStateHistoryEntry, PacketStatus, PinPolicy, Signer,
};
use pin::compute_pin;
use registry::HandoffRegistry;
use serde_json::json;
use std::path::Path;
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
        status_event: ServerEvent,
    },
    Err {
        code: String,
        message: String,
    },
}

#[allow(clippy::large_enum_variant)]
pub enum HandoffApproveOutcome {
    Ok {
        packet: Packet,
        upsert_event: ServerEvent,
        status_event: ServerEvent,
        became_approved: bool,
    },
    Err {
        code: String,
        message: String,
    },
}

#[allow(clippy::large_enum_variant)]
pub enum HandoffRejectOutcome {
    Ok {
        packet: Packet,
        upsert_event: ServerEvent,
        status_event: ServerEvent,
    },
    Err {
        code: String,
        message: String,
    },
}

/// Outcome of `mark_dispatched` — `approved` → `dispatched` transition.
#[allow(clippy::large_enum_variant)]
pub enum HandoffDispatchOutcome {
    Ok {
        packet: Packet,
        upsert_event: ServerEvent,
        status_event: ServerEvent,
    },
    Err {
        code: String,
        message: String,
    },
}

/// Outcome of `record_dispatch_rejected` — no status change, history entry only.
#[allow(clippy::large_enum_variant)]
pub enum HandoffDispatchRejectOutcome {
    Ok {
        packet: Packet,
        upsert_event: ServerEvent,
        status_event: ServerEvent,
    },
    Err {
        code: String,
        message: String,
    },
}

/// Build a snake_case pin payload directly from the typed struct.
///
/// Important: do NOT round-trip through `serde_json::to_value` and then
/// `.get("snake_case")` — `HandoffPin` serializes as camelCase, so the
/// snake_case lookups would all return `None` and the FE would receive
/// a pin with null fields even though the registry packet was complete.
fn pin_to_payload(pin: &packet::HandoffPin) -> serde_json::Value {
    let connectors =
        serde_json::to_value(&pin.connector_snapshots).unwrap_or(serde_json::Value::Array(vec![]));
    json!({
        "repo_ref": pin.repo_ref,
        "base_commit_sha": pin.base_commit_sha,
        "worktree_digest": pin.worktree_digest,
        "assessment_snapshot_at": pin.assessment_snapshot_at,
        "connector_snapshots": connectors,
        "expires_at": pin.expires_at,
        "invalidate_on_repo_change": pin.invalidate_on_repo_change,
        "invalidation_policy": pin.invalidation_policy.as_str(),
        // Aliases preserved for FE store back-compat:
        "base_sha": pin.base_commit_sha,
        "captured_at": pin.assessment_snapshot_at,
        "policy": pin.invalidation_policy.as_str(),
    })
}

fn build_upsert_payload(packet: &Packet) -> serde_json::Value {
    let tasks_payload = serde_json::to_value(&packet.tasks).unwrap_or(serde_json::Value::Null);
    let target_payload = serde_json::to_value(&packet.target).unwrap_or(serde_json::Value::Null);
    let approval_payload =
        serde_json::to_value(&packet.approval).unwrap_or(serde_json::Value::Null);
    let signers_payload = serde_json::to_value(&packet.signers).unwrap_or(serde_json::Value::Null);
    let state_history_payload =
        serde_json::to_value(&packet.state_history).unwrap_or(serde_json::Value::Null);
    json!({
        "packet_id": packet.id,
        "title": packet.title,
        "summary": packet.summary,
        "source_run_ids": packet.source_run_ids,
        "accepted_finding_ids": packet.accepted_finding_ids,
        "created_by": packet.created_by,
        "created_at": packet.created_at,
        "pin": pin_to_payload(&packet.pin),
        "tasks": tasks_payload,
        "order_hint": packet.order_hint,
        "target": target_payload,
        "approval": approval_payload,
        "status": packet.status.as_str(),
        "signers": signers_payload,
        "required_signers": packet.required_signers,
        "state_history": state_history_payload,
        "convergence_count": packet.convergence_count,
        "updated_at": packet.updated_at,
    })
}

fn make_event(
    session_id: &str,
    event_type: &str,
    payload: serde_json::Value,
    now: DateTime<Utc>,
) -> ServerEvent {
    ServerEvent {
        seq: 0,
        session_id: session_id.to_string(),
        event_type: event_type.into(),
        payload,
        v: 1,
        ts: now.to_rfc3339(),
    }
}

fn status_event(packet: &Packet, session_id: &str, now: DateTime<Utc>) -> ServerEvent {
    make_event(
        session_id,
        "handoff.status",
        json!({
            "packet_id": packet.id,
            "status": packet.status.as_str(),
        }),
        now,
    )
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

        // Bridge-owned pin authority: ignore client-supplied `repo_ref` and
        // `base_commit_sha`. Repo identity must come from local git so a
        // malicious or buggy provider cannot forge a pin that bypasses drift
        // detection. `assessment_snapshot_at` and connector snapshots come
        // from the assessment run and are accepted from the payload.
        let pin = compute_pin(pin::PinComputeOptions {
            project_root: params.project_root,
            repo_ref: None,
            base_commit_sha: None,
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

        // Fail closed if git could not derive a complete pin under Strict
        // policy. Lenient policy is allowed to ship with a partial pin
        // (e.g. mock/no-git environments) but Strict is the default and
        // any production handoff must have a verifiable repo identity.
        if pin_policy == PinPolicy::Strict
            && (pin.repo_ref.is_empty()
                || pin.base_commit_sha.is_empty()
                || pin.worktree_digest.is_empty())
        {
            return HandoffCreateOutcome::Err {
                code: "handoff.pin_compute_failed".into(),
                message:
                    "could not derive repo identity from project_root via git; ensure the session is rooted in a git repository or relax pin.invalidation_policy to 'lenient'"
                        .into(),
            };
        }

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
            state_history: vec![
                packet::PacketStateHistoryEntry {
                    state: "draft".to_string(),
                    at: now_ts.clone(),
                    by: Some(params.author.to_string()),
                    reason: None,
                },
                packet::PacketStateHistoryEntry {
                    state: "pending_approval".to_string(),
                    at: now_ts.clone(),
                    by: Some(params.author.to_string()),
                    reason: Some("created".to_string()),
                },
            ],
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

        let upsert_event = make_event(
            params.session_id,
            "handoff.upserted",
            build_upsert_payload(&packet),
            params.now,
        );
        let status_evt = status_event(&packet, params.session_id, params.now);

        self.registry.insert(packet.clone());
        HandoffCreateOutcome::Ok {
            packet,
            upsert_event,
            status_event: status_evt,
        }
    }

    /// Bridge-owned approval transition.
    ///
    /// Adds `signer` to the packet, dedupes by trimmed name, and flips status
    /// to `Approved` once the total signer count reaches `required_signers`.
    /// The packet author cannot self-approve (whitespace-trimmed comparison).
    pub fn approve_handoff(
        &self,
        packet_id: &str,
        signer_name: &str,
        signer_role: &str,
        signer_reason: Option<String>,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> HandoffApproveOutcome {
        let Some(packet) = self.registry.get(packet_id) else {
            return HandoffApproveOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        };

        let trimmed = signer_name.trim().to_string();
        if trimmed.is_empty() {
            return HandoffApproveOutcome::Err {
                code: "handoff.invalid_payload".into(),
                message: "approver name is required".into(),
            };
        }
        let signer_actor_id = canonical_signer_id(signer_name);
        let author_actor_id = canonical_signer_id(&packet.created_by);

        if author_actor_id == signer_actor_id {
            return HandoffApproveOutcome::Err {
                code: "handoff.self_sign_denied".into(),
                message: "author cannot approve their own handoff packet".into(),
            };
        }

        // Explicit state matrix: approve is only valid from `pending_approval`.
        // Anything else (draft, approved, rejected, terminal) must error rather
        // than silently no-op so the FE/audit log records the rejection.
        if packet.status != PacketStatus::PendingApproval {
            return HandoffApproveOutcome::Err {
                code: "handoff.invalid_state".into(),
                message: format!(
                    "approve requires status=pending_approval, got {}",
                    packet.status.as_str()
                ),
            };
        }

        // Reject duplicate signers under the canonical id (trim + case-insensitive).
        // Without this, a malicious or buggy client could cross the
        // required_signers threshold by re-submitting the same human as
        // "alice" / "ALICE" / "  alice  ".
        if packet
            .signers
            .iter()
            .any(|s| canonical_signer_id(&s.name) == signer_actor_id)
        {
            return HandoffApproveOutcome::Err {
                code: "handoff.duplicate_signer".into(),
                message: format!("signer {trimmed} has already approved this packet"),
            };
        }

        let now_str = now.to_rfc3339();
        let mut became_approved = false;
        let updated = self.registry.update(packet_id, |p| {
            p.signers.push(Signer {
                name: trimmed.clone(),
                role: if signer_role.trim().is_empty() {
                    "approver".to_string()
                } else {
                    signer_role.to_string()
                },
                signed_at: now_str.clone(),
                reason: signer_reason.clone(),
            });
            if !p
                .approval
                .approvers
                .iter()
                .any(|a| canonical_signer_id(a) == signer_actor_id)
            {
                p.approval.approvers.push(trimmed.clone());
            }
            if p.status == PacketStatus::PendingApproval
                && (p.signers.len() as u32) >= p.required_signers.max(1)
            {
                p.status = PacketStatus::Approved;
                p.approval.approved_at = Some(now_str.clone());
                p.state_history.push(PacketStateHistoryEntry {
                    state: "approved".to_string(),
                    at: now_str.clone(),
                    by: Some(trimmed.clone()),
                    reason: None,
                });
                became_approved = true;
            }
            p.updated_at = now_str.clone();
        });
        if !updated {
            return HandoffApproveOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        }

        let updated_packet = match self.registry.get(packet_id) {
            Some(p) => p,
            None => {
                return HandoffApproveOutcome::Err {
                    code: "handoff.not_found".into(),
                    message: format!("packet {packet_id} not found"),
                }
            }
        };

        let upsert_event = make_event(
            session_id,
            "handoff.upserted",
            build_upsert_payload(&updated_packet),
            now,
        );
        let status_evt = status_event(&updated_packet, session_id, now);

        HandoffApproveOutcome::Ok {
            packet: updated_packet,
            upsert_event,
            status_event: status_evt,
            became_approved,
        }
    }

    /// Bridge-owned rejection transition. Terminal; cannot be undone via this API.
    pub fn reject_handoff(
        &self,
        packet_id: &str,
        rejector: &str,
        reason: Option<String>,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> HandoffRejectOutcome {
        let Some(packet) = self.registry.get(packet_id) else {
            return HandoffRejectOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        };

        let trimmed = rejector.trim().to_string();
        if trimmed.is_empty() {
            return HandoffRejectOutcome::Err {
                code: "handoff.invalid_payload".into(),
                message: "rejector name is required".into(),
            };
        }

        // Explicit state matrix: reject is only valid from `pending_approval`.
        // Once a packet has been approved, dispatched, or already terminal, the
        // reject path must error so callers must use a follow-up workflow
        // (cancel/expire) instead of silently rewriting state.
        if packet.status != PacketStatus::PendingApproval {
            return HandoffRejectOutcome::Err {
                code: "handoff.invalid_state".into(),
                message: format!(
                    "reject requires status=pending_approval, got {}",
                    packet.status.as_str()
                ),
            };
        }

        let now_str = now.to_rfc3339();
        let updated = self.registry.update(packet_id, |p| {
            p.status = PacketStatus::Rejected;
            p.state_history.push(PacketStateHistoryEntry {
                state: "rejected".to_string(),
                at: now_str.clone(),
                by: Some(trimmed.clone()),
                reason: reason.clone(),
            });
            p.updated_at = now_str.clone();
        });
        if !updated {
            return HandoffRejectOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        }

        let updated_packet = match self.registry.get(packet_id) {
            Some(p) => p,
            None => {
                return HandoffRejectOutcome::Err {
                    code: "handoff.not_found".into(),
                    message: format!("packet {packet_id} not found"),
                }
            }
        };

        let upsert_event = make_event(
            session_id,
            "handoff.upserted",
            build_upsert_payload(&updated_packet),
            now,
        );
        let status_evt = status_event(&updated_packet, session_id, now);

        HandoffRejectOutcome::Ok {
            packet: updated_packet,
            upsert_event,
            status_event: status_evt,
        }
    }

    /// Dispatch guard. Recomputes the current pin under Strict policy and
    /// rejects with `handoff.pin_drift` if any of `repo_ref`,
    /// `base_commit_sha`, or `worktree_digest` no longer match.
    pub fn check_dispatch(
        &self,
        packet_id: &str,
        project_root: &Path,
        now: DateTime<Utc>,
    ) -> Result<Packet, DispatchError> {
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

        if packet.pin.invalidation_policy == PinPolicy::Strict {
            let current = compute_pin(pin::PinComputeOptions {
                project_root,
                repo_ref: None,
                base_commit_sha: None,
                assessment_snapshot_at: Some(packet.pin.assessment_snapshot_at.clone()),
                connector_snapshots: vec![],
                invalidation_policy: PinPolicy::Strict,
                now,
            });
            if current.repo_ref != packet.pin.repo_ref
                || current.base_commit_sha != packet.pin.base_commit_sha
                || current.worktree_digest != packet.pin.worktree_digest
            {
                let reason = format!(
                    "strict pin drift: repo_ref {}\u{2192}{}, base_sha {}\u{2192}{}, digest {}\u{2192}{}",
                    packet.pin.repo_ref,
                    current.repo_ref,
                    packet.pin.base_commit_sha.chars().take(12).collect::<String>(),
                    current.base_commit_sha.chars().take(12).collect::<String>(),
                    packet.pin.worktree_digest.chars().take(12).collect::<String>(),
                    current.worktree_digest.chars().take(12).collect::<String>(),
                );
                return Err(DispatchError::PinDrift { reason });
            }
        }

        Ok(packet)
    }

    /// Transition `approved` → `dispatched` after the runtime provider has
    /// accepted the dispatch. Records a `dispatched` state-history entry with
    /// reason `dispatch_allowed` and emits `handoff.upserted` + `handoff.status`.
    ///
    /// This must NOT be called when the provider rejected or was unreachable;
    /// in that path use `record_dispatch_rejected` instead so the packet stays
    /// in `approved` and an auditable history entry is written.
    pub fn mark_dispatched(
        &self,
        packet_id: &str,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> HandoffDispatchOutcome {
        let Some(packet) = self.registry.get(packet_id) else {
            return HandoffDispatchOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        };

        if packet.status != PacketStatus::Approved {
            return HandoffDispatchOutcome::Err {
                code: "handoff.invalid_state".into(),
                message: format!(
                    "dispatch requires status=approved, got {}",
                    packet.status.as_str()
                ),
            };
        }

        let now_str = now.to_rfc3339();
        let updated = self.registry.update(packet_id, |p| {
            p.status = PacketStatus::Dispatched;
            p.state_history.push(PacketStateHistoryEntry {
                state: "dispatched".to_string(),
                at: now_str.clone(),
                by: None,
                reason: Some("dispatch_allowed".to_string()),
            });
            p.updated_at = now_str.clone();
        });
        if !updated {
            return HandoffDispatchOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        }

        let updated_packet = match self.registry.get(packet_id) {
            Some(p) => p,
            None => {
                return HandoffDispatchOutcome::Err {
                    code: "handoff.not_found".into(),
                    message: format!("packet {packet_id} not found"),
                }
            }
        };

        let upsert_event = make_event(
            session_id,
            "handoff.upserted",
            build_upsert_payload(&updated_packet),
            now,
        );
        let status_evt = status_event(&updated_packet, session_id, now);

        HandoffDispatchOutcome::Ok {
            packet: updated_packet,
            upsert_event,
            status_event: status_evt,
        }
    }

    /// Record a `dispatch_rejected` history entry without transitioning status.
    ///
    /// Used when `check_dispatch` returns an error (drift / expired /
    /// not_approved / pin_incomplete) or the runtime provider rejects /
    /// is unreachable (provider_error). The packet stays in its current
    /// status (typically `approved`); only the auditable history is appended.
    pub fn record_dispatch_rejected(
        &self,
        packet_id: &str,
        reason_tag: &str,
        detail: Option<String>,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> HandoffDispatchRejectOutcome {
        if self.registry.get(packet_id).is_none() {
            return HandoffDispatchRejectOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        }

        let now_str = now.to_rfc3339();
        let reason_str = match detail {
            Some(d) if !d.is_empty() => format!("{reason_tag}: {d}"),
            _ => reason_tag.to_string(),
        };
        let updated = self.registry.update(packet_id, |p| {
            p.state_history.push(PacketStateHistoryEntry {
                state: "dispatch_rejected".to_string(),
                at: now_str.clone(),
                by: None,
                reason: Some(reason_str.clone()),
            });
            p.updated_at = now_str.clone();
        });
        if !updated {
            return HandoffDispatchRejectOutcome::Err {
                code: "handoff.not_found".into(),
                message: format!("packet {packet_id} not found"),
            };
        }

        let updated_packet = match self.registry.get(packet_id) {
            Some(p) => p,
            None => {
                return HandoffDispatchRejectOutcome::Err {
                    code: "handoff.not_found".into(),
                    message: format!("packet {packet_id} not found"),
                }
            }
        };

        let upsert_event = make_event(
            session_id,
            "handoff.upserted",
            build_upsert_payload(&updated_packet),
            now,
        );
        let status_evt = status_event(&updated_packet, session_id, now);

        HandoffDispatchRejectOutcome::Ok {
            packet: updated_packet,
            upsert_event,
            status_event: status_evt,
        }
    }
}

#[derive(Debug)]
pub enum DispatchError {
    NotFound,
    NotApproved,
    PinIncomplete,
    PinExpired,
    PinDrift { reason: String },
}

impl DispatchError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "handoff.not_found",
            Self::NotApproved => "handoff.not_approved",
            Self::PinIncomplete => "handoff.pin_incomplete",
            Self::PinExpired => "handoff.pin_expired",
            Self::PinDrift { .. } => "handoff.pin_drift",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::NotFound => "packet not found".to_string(),
            Self::NotApproved => "packet must be approved before dispatch".to_string(),
            Self::PinIncomplete => "pin is incomplete".to_string(),
            Self::PinExpired => "pin has expired".to_string(),
            Self::PinDrift { reason } => reason.clone(),
        }
    }

    /// Short, stable tag for `state_history.reason` and audit logs.
    /// One of: `not_found`, `not_approved`, `pin_incomplete`, `expired`, `drift`.
    pub fn reason_tag(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::NotApproved => "not_approved",
            Self::PinIncomplete => "pin_incomplete",
            Self::PinExpired => "expired",
            Self::PinDrift { .. } => "drift",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handoff::packet::PacketStatus;
    use std::path::PathBuf;
    use std::process::Command;

    fn run_git(dir: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .expect("git command");
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_path_buf();
        run_git(&root, &["init", "-q", "--initial-branch=main"]);
        std::fs::write(root.join("README.md"), "hello\n").unwrap();
        run_git(&root, &["add", "-A"]);
        run_git(&root, &["commit", "-q", "-m", "init"]);
        (dir, root)
    }

    fn sample_payload() -> serde_json::Value {
        json!({
            "created_by": "alice",
            "title": "Fix login",
            "accepted_finding_ids": ["f1"],
            "tasks": [{
                "id": "task_1",
                "title": "Patch auth bug",
                "source_finding_ids": ["f1"],
                "evidence_refs": [{"id": "ev1", "uri": "file:///workspace/src/a.ts"}],
                "touches_paths": ["src/a.ts"],
                "requires_approval_per_step": false
            }],
            "target": {
                "kind": "dispatch_to_local_vac",
                "executor_profile_id": "executor.code@1.0.0"
            },
            "pin": { "invalidation_policy": "strict" }
        })
    }

    #[test]
    fn create_emits_complete_snake_case_pin_payload() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let outcome = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        });
        let HandoffCreateOutcome::Ok {
            upsert_event,
            packet,
            ..
        } = outcome
        else {
            panic!("expected Ok");
        };
        let pin = upsert_event.payload.get("pin").expect("pin in payload");
        // BLOCKER 1 regression guard: snake_case keys must be present and non-null.
        for key in [
            "repo_ref",
            "base_commit_sha",
            "worktree_digest",
            "assessment_snapshot_at",
            "connector_snapshots",
            "expires_at",
            "invalidate_on_repo_change",
            "invalidation_policy",
        ] {
            let v = pin.get(key).unwrap_or_else(|| panic!("missing pin.{key}"));
            assert!(!v.is_null(), "pin.{key} must not be null");
        }
        assert!(
            pin.get("worktree_digest")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false),
            "worktree_digest must be a non-empty string, got: {:?}",
            pin.get("worktree_digest")
        );
        assert_eq!(packet.status, PacketStatus::PendingApproval);
    }

    #[test]
    fn create_ignores_client_supplied_repo_identity() {
        let (_tmp, root) = init_repo();
        let actual_head = String::from_utf8(
            Command::new("git")
                .current_dir(&root)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        let mut payload = sample_payload();
        payload["pin"]["repo_ref"] = json!("branch:fake-branch");
        payload["pin"]["base_commit_sha"] = json!("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

        let svc = HandoffService::new();
        let outcome = svc.create_handoff(HandoffCreateParams {
            payload: &payload,
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        });
        let HandoffCreateOutcome::Ok { packet, .. } = outcome else {
            panic!("expected Ok");
        };
        // Client-supplied fakes must be ignored — bridge derives both fields from local git.
        assert_ne!(
            packet.pin.base_commit_sha,
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
        );
        assert_eq!(packet.pin.base_commit_sha, actual_head);
        assert!(packet.pin.repo_ref.starts_with("branch:"));
        assert_ne!(packet.pin.repo_ref, "branch:fake-branch");
    }

    #[test]
    fn create_rejects_strict_pin_compute_failure_when_no_git() {
        // No git repo at this path → strict pin must fail closed.
        let tmp = tempfile::tempdir().unwrap();
        let svc = HandoffService::new();
        let outcome = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: tmp.path(),
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        });
        match outcome {
            HandoffCreateOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.pin_compute_failed")
            }
            _ => panic!("expected pin_compute_failed"),
        }
    }

    #[test]
    fn approve_flips_status_to_approved() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let outcome = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        });
        let HandoffCreateOutcome::Ok { packet, .. } = outcome else {
            panic!("expected Ok");
        };
        let result = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Ok {
                packet: updated,
                became_approved,
                ..
            } => {
                assert!(became_approved);
                assert_eq!(updated.status, PacketStatus::Approved);
                assert!(updated.approval.approvers.iter().any(|a| a == "bob"));
                assert!(updated.approval.approved_at.is_some());
            }
            HandoffApproveOutcome::Err { code, message } => {
                panic!("approve failed: {code}: {message}")
            }
        }
    }

    #[test]
    fn approve_rejects_self_sign() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let outcome = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        });
        let HandoffCreateOutcome::Ok { packet, .. } = outcome else {
            panic!("expected Ok");
        };
        // Trim guard: trailing whitespace must not bypass self-sign deny.
        let result =
            svc.approve_handoff(&packet.id, "  alice  ", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.self_sign_denied")
            }
            HandoffApproveOutcome::Ok { .. } => panic!("self-sign must be denied"),
        }
    }

    #[test]
    fn dispatch_guard_passes_after_approve_with_clean_repo() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create failed");
        };
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        let result = svc.check_dispatch(&packet.id, &root, Utc::now());
        assert!(result.is_ok(), "dispatch should pass on clean repo");
    }

    #[test]
    fn dispatch_guard_rejects_strict_repo_drift() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create failed");
        };
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());

        // Mutate worktree by adding a tracked file then committing — base sha + digest both move.
        std::fs::write(root.join("NEW.md"), "drifted\n").unwrap();
        run_git(&root, &["add", "-A"]);
        run_git(&root, &["commit", "-q", "-m", "drift"]);

        let result = svc.check_dispatch(&packet.id, &root, Utc::now());
        match result {
            Err(DispatchError::PinDrift { .. }) => {}
            other => panic!("expected PinDrift, got {other:?}"),
        }
    }

    #[test]
    fn reject_flips_status_to_rejected() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create failed");
        };
        let result = svc.reject_handoff(
            &packet.id,
            "bob",
            Some("insufficient evidence".into()),
            "s1",
            Utc::now(),
        );
        match result {
            HandoffRejectOutcome::Ok {
                packet: updated, ..
            } => {
                assert_eq!(updated.status, PacketStatus::Rejected);
                // Reject must record a `rejected` history entry with reason.
                let last = updated.state_history.last().expect("history");
                assert_eq!(last.state, "rejected");
                assert_eq!(last.reason.as_deref(), Some("insufficient evidence"));
            }
            HandoffRejectOutcome::Err { code, message } => {
                panic!("reject failed: {code}: {message}")
            }
        }
    }

    // ---------------------------------------------------------------------
    // State machine hardening tests
    // ---------------------------------------------------------------------

    fn create_pending_packet(svc: &HandoffService, root: &std::path::Path) -> Packet {
        let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create failed");
        };
        packet
    }

    #[test]
    fn create_seeds_draft_then_pending_approval_history() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        // First two state_history entries must record the draft → pending_approval
        // transition done at creation. This is the auditable record that the
        // packet did pass through `draft` rather than appearing fully-formed
        // in `pending_approval`.
        assert!(
            packet.state_history.len() >= 2,
            "expected at least 2 history entries, got {:?}",
            packet.state_history
        );
        assert_eq!(packet.state_history[0].state, "draft");
        assert_eq!(packet.state_history[1].state, "pending_approval");
        assert_eq!(packet.state_history[1].reason.as_deref(), Some("created"));
        assert_eq!(packet.status, PacketStatus::PendingApproval);
    }

    #[test]
    fn approve_dedups_canonical_signer_id() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);

        // First approve from `bob` flips to Approved (required_signers=1 for
        // non-two-party; author counted, plus one external = 2 ≥ 1).
        let HandoffApproveOutcome::Ok {
            packet: after_first,
            ..
        } = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now())
        else {
            panic!("first approve must succeed");
        };
        assert_eq!(after_first.status, PacketStatus::Approved);

        // Second approve from canonical-equivalent `BOB ` must be rejected
        // with a stable `handoff.duplicate_signer` code, not silently no-op.
        // (It would also be rejected by the state matrix because the packet
        // is now Approved, but duplicate_signer is the more specific signal.)
        let result =
            svc.approve_handoff(&after_first.id, "BOB ", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, .. } => {
                assert!(
                    code == "handoff.duplicate_signer" || code == "handoff.invalid_state",
                    "expected duplicate_signer or invalid_state, got {code}"
                );
            }
            HandoffApproveOutcome::Ok { .. } => panic!("duplicate signer must be rejected"),
        }
    }

    #[test]
    fn approve_dedups_canonical_signer_id_pre_threshold() {
        // Force two_party so required_signers=2 and a single external
        // approver is not enough — lets us hit the duplicate guard *before*
        // the packet flips to Approved (so invalid_state can't shadow it).
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let mut payload = sample_payload();
        payload["approval"] = json!({ "two_party": true });
        let HandoffCreateOutcome::Ok { packet, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &payload,
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create failed");
        };

        let HandoffApproveOutcome::Ok {
            packet: after_first,
            became_approved,
            ..
        } = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now())
        else {
            panic!("first approve must succeed");
        };
        assert!(
            became_approved,
            "two_party with author+bob = 2 >= 2 should flip"
        );
        // For two-party with a pre-signed author, even the first non-author
        // approval is enough. So we instead simulate a fresh pending packet
        // with required_signers=3 by mutating registry directly.
        let _ = after_first; // suppress unused

        // Build another packet and bump required_signers via the registry so
        // we can test pre-threshold dedup cleanly.
        let HandoffCreateOutcome::Ok { packet: p2, .. } = svc.create_handoff(HandoffCreateParams {
            payload: &sample_payload(),
            project_root: &root,
            session_id: "s1",
            author: "alice",
            now: Utc::now(),
        }) else {
            panic!("create p2 failed");
        };
        let bumped = svc.registry.update(&p2.id, |p| {
            p.required_signers = 3;
        });
        assert!(bumped);

        // First approve adds bob; status stays PendingApproval (signers=2 < 3).
        let HandoffApproveOutcome::Ok {
            became_approved, ..
        } = svc.approve_handoff(&p2.id, "bob", "approver", None, "s1", Utc::now())
        else {
            panic!("first approve on p2 must succeed");
        };
        assert!(!became_approved);

        // Second approve from `  BOB " must be deduped — packet still PendingApproval.
        let result = svc.approve_handoff(&p2.id, "  BOB ", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.duplicate_signer");
            }
            HandoffApproveOutcome::Ok { .. } => panic!("canonical-dup signer must be rejected"),
        }
        // Status untouched.
        let after = svc.registry.get(&p2.id).expect("packet present");
        assert_eq!(after.status, PacketStatus::PendingApproval);
        // Only one external signer recorded.
        let bobs = after
            .signers
            .iter()
            .filter(|s| canonical_signer_id(&s.name) == "bob")
            .count();
        assert_eq!(bobs, 1, "canonical dedup must keep exactly one bob signer");
    }

    #[test]
    fn approve_self_sign_blocks_case_variant() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        // Author is `alice`. Submitting `ALICE` (case variant) must hit
        // the self-sign deny via the canonical id, not bypass to approve.
        let result = svc.approve_handoff(&packet.id, "ALICE", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.self_sign_denied");
            }
            HandoffApproveOutcome::Ok { .. } => panic!("case-variant self-sign must be denied"),
        }
    }

    #[test]
    fn approve_rejects_invalid_state_transition_from_draft() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        // Force packet back to Draft to simulate an invalid transition request.
        let mutated = svc.registry.update(&packet.id, |p| {
            p.status = PacketStatus::Draft;
        });
        assert!(mutated);

        // approve must error with handoff.invalid_state — draft → approved
        // is NOT a permitted transition (must go through pending_approval).
        let result = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, message } => {
                assert_eq!(code, "handoff.invalid_state");
                assert!(
                    message.contains("pending_approval"),
                    "error must name expected source state, got {message}"
                );
            }
            HandoffApproveOutcome::Ok { .. } => {
                panic!("draft → approved transition must be rejected")
            }
        }
        // Status must be unchanged (still Draft).
        let after = svc.registry.get(&packet.id).expect("packet present");
        assert_eq!(after.status, PacketStatus::Draft);
    }

    #[test]
    fn approve_rejects_already_approved() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        // Re-approving an already-approved packet must error rather than
        // silently appending another signer.
        let result = svc.approve_handoff(&packet.id, "carol", "approver", None, "s1", Utc::now());
        match result {
            HandoffApproveOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.invalid_state");
            }
            HandoffApproveOutcome::Ok { .. } => {
                panic!("approve from approved state must be rejected")
            }
        }
    }

    #[test]
    fn reject_rejects_invalid_state_transition_from_approved() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        // approved → rejected is not a permitted transition.
        let result = svc.reject_handoff(
            &packet.id,
            "carol",
            Some("changed mind".into()),
            "s1",
            Utc::now(),
        );
        match result {
            HandoffRejectOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.invalid_state");
            }
            HandoffRejectOutcome::Ok { .. } => {
                panic!("approved → rejected transition must be denied")
            }
        }
    }

    #[test]
    fn mark_dispatched_flips_approved_to_dispatched_with_history() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());

        let outcome = svc.mark_dispatched(&packet.id, "s1", Utc::now());
        let HandoffDispatchOutcome::Ok {
            packet: dispatched,
            upsert_event,
            status_event,
        } = outcome
        else {
            panic!("mark_dispatched on Approved must succeed");
        };
        assert_eq!(dispatched.status, PacketStatus::Dispatched);
        // History must include `dispatched` with reason `dispatch_allowed`.
        let last = dispatched.state_history.last().expect("history");
        assert_eq!(last.state, "dispatched");
        assert_eq!(last.reason.as_deref(), Some("dispatch_allowed"));
        // Events must reflect the new status.
        assert_eq!(upsert_event.event_type, "handoff.upserted");
        assert_eq!(status_event.event_type, "handoff.status");
        assert_eq!(
            status_event.payload.get("status").and_then(|v| v.as_str()),
            Some("dispatched")
        );
    }

    #[test]
    fn mark_dispatched_rejects_when_not_approved() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        // Pending (no approve) — mark_dispatched must error and NOT flip status.
        let outcome = svc.mark_dispatched(&packet.id, "s1", Utc::now());
        match outcome {
            HandoffDispatchOutcome::Err { code, .. } => {
                assert_eq!(code, "handoff.invalid_state");
            }
            HandoffDispatchOutcome::Ok { .. } => {
                panic!("mark_dispatched without approval must be rejected")
            }
        }
        let after = svc.registry.get(&packet.id).expect("packet present");
        assert_eq!(after.status, PacketStatus::PendingApproval);
        assert!(after.state_history.iter().all(|h| h.state != "dispatched"));
    }

    #[test]
    fn record_dispatch_rejected_writes_history_without_status_change() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());

        // Simulate dispatch rejection due to drift.
        let outcome = svc.record_dispatch_rejected(
            &packet.id,
            "drift",
            Some("base sha moved".into()),
            "s1",
            Utc::now(),
        );
        let HandoffDispatchRejectOutcome::Ok {
            packet: after,
            upsert_event,
            status_event,
        } = outcome
        else {
            panic!("record_dispatch_rejected must succeed");
        };
        // Status must remain Approved — packet must NOT be dispatched.
        assert_eq!(after.status, PacketStatus::Approved);
        // History must contain a dispatch_rejected entry with the reason tag.
        let last = after.state_history.last().expect("history");
        assert_eq!(last.state, "dispatch_rejected");
        let reason = last.reason.as_deref().unwrap_or_default();
        assert!(
            reason.starts_with("drift"),
            "reason must start with drift tag, got {reason}"
        );
        // Events emitted for FE.
        assert_eq!(upsert_event.event_type, "handoff.upserted");
        assert_eq!(status_event.event_type, "handoff.status");
        // Status event still reports `approved`, since status unchanged.
        assert_eq!(
            status_event.payload.get("status").and_then(|v| v.as_str()),
            Some("approved")
        );
    }

    #[test]
    fn dispatch_error_reason_tags_are_stable() {
        // These tags are wired into translator audit logs and state_history
        // reasons — changing them is a wire-format break.
        assert_eq!(DispatchError::NotFound.reason_tag(), "not_found");
        assert_eq!(DispatchError::NotApproved.reason_tag(), "not_approved");
        assert_eq!(DispatchError::PinIncomplete.reason_tag(), "pin_incomplete");
        assert_eq!(DispatchError::PinExpired.reason_tag(), "expired");
        assert_eq!(
            DispatchError::PinDrift { reason: "x".into() }.reason_tag(),
            "drift"
        );
    }

    #[test]
    fn full_lifecycle_writes_history_for_each_transition() {
        let (_tmp, root) = init_repo();
        let svc = HandoffService::new();
        let packet = create_pending_packet(&svc, &root);
        let _ = svc.approve_handoff(&packet.id, "bob", "approver", None, "s1", Utc::now());
        let _ = svc.record_dispatch_rejected(
            &packet.id,
            "provider_error",
            Some("engine offline".into()),
            "s1",
            Utc::now(),
        );
        let HandoffDispatchOutcome::Ok {
            packet: final_packet,
            ..
        } = svc.mark_dispatched(&packet.id, "s1", Utc::now())
        else {
            panic!("mark_dispatched after recover must succeed");
        };

        let states: Vec<&str> = final_packet
            .state_history
            .iter()
            .map(|h| h.state.as_str())
            .collect();
        // Required ordered subsequence:
        //   draft → pending_approval → approved → dispatch_rejected → dispatched
        let expected = [
            "draft",
            "pending_approval",
            "approved",
            "dispatch_rejected",
            "dispatched",
        ];
        let mut idx = 0;
        for s in &states {
            if idx < expected.len() && *s == expected[idx] {
                idx += 1;
            }
        }
        assert_eq!(
            idx,
            expected.len(),
            "history missing required transition; got {:?}",
            states
        );
        assert_eq!(final_packet.status, PacketStatus::Dispatched);
    }
}
