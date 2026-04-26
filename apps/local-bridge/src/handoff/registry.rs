//! In-memory handoff packet registry.
//!
//! Current milestone: in-memory store only. Persistence can be layered in
//! later without changing the registry interface. The registry is session-agnostic
//! — packets are identified by packet_id globally.

use crate::handoff::packet::{Packet, PacketStatus};
use dashmap::DashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct HandoffRegistry {
    packets: Arc<DashMap<String, Packet>>,
}

impl Default for HandoffRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl HandoffRegistry {
    pub fn new() -> Self {
        Self {
            packets: Arc::new(DashMap::new()),
        }
    }

    pub fn insert(&self, packet: Packet) {
        self.packets.insert(packet.id.clone(), packet);
    }

    pub fn get(&self, packet_id: &str) -> Option<Packet> {
        self.packets.get(packet_id).map(|r| r.clone())
    }

    pub fn update<F>(&self, packet_id: &str, f: F) -> bool
    where
        F: FnOnce(&mut Packet),
    {
        if let Some(mut entry) = self.packets.get_mut(packet_id) {
            f(&mut entry);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, packet_id: &str) -> Option<Packet> {
        self.packets.remove(packet_id).map(|(_, v)| v)
    }

    pub fn list(&self) -> Vec<Packet> {
        self.packets.iter().map(|r| r.clone()).collect()
    }

    /// Return the active packet already occupying the given executor profile
    /// for the same project identity. The project key is derived from the
    /// packet pin (repo_ref + base_commit_sha), not the ephemeral worktree
    /// path, so identical repo state collides reliably across sessions.
    pub fn active_executor_packet(
        &self,
        executor_profile_id: &str,
        project_key: &str,
    ) -> Option<Packet> {
        self.packets
            .iter()
            .find(|entry| {
                let packet = entry.value();
                matches!(
                    packet.status,
                    PacketStatus::Dispatched | PacketStatus::Executing
                ) && packet.target.executor_profile_id == executor_profile_id
                    && format!("{}::{}", packet.pin.repo_ref, packet.pin.base_commit_sha)
                        == project_key
            })
            .map(|entry| entry.value().clone())
    }

    pub fn set_status(&self, packet_id: &str, status: PacketStatus) -> bool {
        self.update(packet_id, |p| {
            let now = chrono::Utc::now().to_rfc3339();
            p.status = status;
            p.updated_at = now.clone();
            p.state_history
                .push(crate::handoff::packet::PacketStateHistoryEntry {
                    state: status.as_str().to_string(),
                    at: now,
                    by: None,
                    reason: None,
                });
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handoff::packet::{
        HandoffApproval, HandoffPin, HandoffTarget, PacketTask, PinPolicy,
    };
    use chrono::Utc;

    fn make_test_pin() -> HandoffPin {
        HandoffPin {
            repo_ref: "branch:main".to_string(),
            base_commit_sha: "abc123".to_string(),
            worktree_digest: "digest".to_string(),
            assessment_snapshot_at: Utc::now().to_rfc3339(),
            connector_snapshots: vec![],
            expires_at: (Utc::now() + chrono::Duration::days(7)).to_rfc3339(),
            invalidate_on_repo_change: true,
            invalidation_policy: PinPolicy::Strict,
        }
    }

    fn make_test_packet(id: &str) -> Packet {
        Packet {
            id: id.to_string(),
            title: "Test Packet".to_string(),
            summary: None,
            source_run_ids: vec![],
            accepted_finding_ids: vec![],
            created_by: "alice".to_string(),
            created_at: Utc::now().to_rfc3339(),
            pin: make_test_pin(),
            tasks: vec![PacketTask {
                id: "task_1".to_string(),
                title: "Do thing".to_string(),
                rationale: "Because".to_string(),
                source_finding_ids: vec!["f1".to_string()],
                evidence_refs: vec![],
                steps: vec![],
                constraints: vec![],
                risk_notes: vec![],
                est_effort: None,
                depends_on: vec![],
                touches_paths: vec![],
                requires_approval_per_step: false,
                rollback_steps: vec![],
            }],
            order_hint: Some(vec!["task_1".to_string()]),
            target: HandoffTarget {
                kind: "dispatch_to_local_vac".to_string(),
                executor_profile_id: "executor.code@1.0.0".to_string(),
                session_title: None,
            },
            approval: HandoffApproval {
                required: true,
                approvers: vec![],
                approver_notes: None,
                approved_at: None,
                two_party: false,
                required_roles: vec![],
            },
            status: PacketStatus::PendingApproval,
            state_history: vec![],
            signers: vec![],
            required_signers: 2,
            execution_session_id: None,
            execution_progress: None,
            execution_outcome: None,
            convergence_count: 0,
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn test_insert_and_get() {
        let reg = HandoffRegistry::new();
        let packet = make_test_packet("p1");
        reg.insert(packet.clone());
        assert_eq!(reg.get("p1").map(|p| p.id), Some("p1".to_string()));
    }

    #[test]
    fn test_get_missing() {
        let reg = HandoffRegistry::new();
        assert!(reg.get("nonexistent").is_none());
    }

    #[test]
    fn test_update_status() {
        let reg = HandoffRegistry::new();
        reg.insert(make_test_packet("p1"));
        assert!(reg.set_status("p1", PacketStatus::Approved));
        assert_eq!(
            reg.get("p1").map(|p| p.status),
            Some(PacketStatus::Approved)
        );
    }

    #[test]
    fn test_update_missing_returns_false() {
        let reg = HandoffRegistry::new();
        assert!(!reg.set_status("nonexistent", PacketStatus::Approved));
    }

    #[test]
    fn test_remove() {
        let reg = HandoffRegistry::new();
        reg.insert(make_test_packet("p1"));
        assert!(reg.remove("p1").is_some());
        assert!(reg.get("p1").is_none());
    }

    #[test]
    fn test_can_dispatch() {
        let mut packet = make_test_packet("p1");
        assert!(!packet.can_dispatch());
        packet.status = PacketStatus::Approved;
        assert!(packet.can_dispatch());
    }
}
