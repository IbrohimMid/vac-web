// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/handoff_packet.schema.json

import type { EvidenceRef } from './EvidenceRef';

export interface HandoffPacket {
  accepted_finding_ids: string[];
  approval: HandoffPacketApproval;
  chained_from_handoff_id?: string;
  created_at: string;
  created_by: string;
  execution_outcome?: HandoffPacketExecutionOutcome;
  execution_session_id?: string;
  id: string;
  order_hint?: string[];
  pin: HandoffPacketPin;
  source_run_ids: string[];
  state: 'draft' | 'pending_approval' | 'approved' | 'dispatched' | 'executing' | 'completed' | 'rejected' | 'cancelled' | 'invalidated' | 'expired';
  state_history: HandoffPacketStateHistory[];
  summary?: string;
  target: HandoffPacketTarget;
  tasks: HandoffPacketTask[];
  title: string;
}

export interface HandoffPacketApproval {
  approved_at?: string;
  approver_notes?: string;
  approvers?: string[];
  required: boolean;
  required_roles?: string[];
  two_party: boolean;
}

export interface HandoffPacketExecutionOutcome {
  changeset_summary?: string;
  reassessment_run_id?: string;
  status?: 'success' | 'partial' | 'failed' | 'cancelled';
  tasks_completed?: string[];
  tasks_failed?: string[];
}

export interface HandoffPacketPinConnectorSnapshot {
  captured_at: string;
  connector_id: string;
  kind: string;
  snapshot_id: string;
}

export interface HandoffPacketPin {
  assessment_snapshot_at: string;
  base_commit_sha: string;
  connector_snapshots?: HandoffPacketPinConnectorSnapshot[];
  expires_at: string;
  invalidate_on_repo_change: boolean;
  invalidation_policy: 'strict' | 'lenient';
  repo_ref: string;
  worktree_digest: string;
}

export interface HandoffPacketStateHistory {
  at: string;
  by?: string;
  reason?: string;
  state: string;
}

export interface HandoffPacketTarget {
  executor_profile_id: string;
  kind: 'dispatch_to_local_vac' | 'dispatch_to_vac_web_cli' | 'export_as_blueprint_only';
  session_title?: string;
}

export interface HandoffPacketTask {
  constraints?: string[];
  depends_on?: string[];
  est_effort?: 'hours' | 'days' | 'weeks';
  evidence_refs?: EvidenceRef[];
  id: string;
  rationale: string;
  requires_approval_per_step?: boolean;
  risk_notes?: string[];
  steps: string[];
  title: string;
  touches_paths?: string[];
}
