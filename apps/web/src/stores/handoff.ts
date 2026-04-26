// Handoff packet store. Spec: docs/handoff-contract.md.
//
// Packet shape is the contract packet model: source runs + accepted findings
// + pin + structured tasks + target + approval state. The store keeps a few
// legacy aliases around so older partial updates still merge cleanly during the
// migration.
//
// Convergence guard: persistent+regressed counts tracked across handoff→reassess
// cycles; 3 cycles without strictly-decreasing count fires a sticky banner.

import { create } from 'zustand';
import type { EvidenceRef as AssessmentEvidenceRef } from './assessment';

export type PacketStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'dispatched'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'invalidated'
  | 'expired';

export type PinPolicy = 'strict' | 'lenient';

export interface HandoffConnectorSnapshot {
  connector_id: string;
  kind: string;
  snapshot_id: string;
  captured_at: string;
  etag?: string;
}

export interface HandoffPin {
  repo_ref: string;
  base_commit_sha: string;
  worktree_digest: string;
  assessment_snapshot_at: string;
  connector_snapshots: HandoffConnectorSnapshot[];
  expires_at: string;
  invalidate_on_repo_change: boolean;
  invalidation_policy: PinPolicy;
  // Legacy aliases during migration.
  base_sha?: string;
  captured_at?: string;
  policy?: PinPolicy;
}

export interface PacketTask {
  id: string;
  title: string;
  rationale: string;
  source_finding_ids: string[];
  evidence_refs: AssessmentEvidenceRef[];
  steps: string[];
  constraints: string[];
  risk_notes: string[];
  est_effort: 'hours' | 'days' | 'weeks';
  depends_on: string[];
  touches_paths: string[];
  requires_approval_per_step: boolean;
  rollback_steps: string[];
  // Legacy aliases during migration.
  finding_ids?: string[];
  constraint?: string;
}

export interface Signer {
  name: string;
  role: 'author' | 'approver';
  signed_at: string;
  reason?: string;
}

export interface TaskExecutionProgress {
  task_id: string;
  status: 'pending' | 'started' | 'completed' | 'failed';
  updated_at: string;
  completed: number;
  total: number;
  message?: string;
}

export interface HandoffApproval {
  required: boolean;
  approvers: string[];
  approver_notes?: string;
  approved_at?: string;
  two_party: boolean;
  required_roles: string[];
}

export interface HandoffTarget {
  kind: 'dispatch_to_local_vac' | 'dispatch_to_vac_web_cli' | 'export_as_blueprint_only';
  executor_profile_id: string;
  session_title?: string;
  // Legacy alias during migration.
  profile_id?: string;
}

export interface PacketStateHistoryEntry {
  state: PacketStatus | string;
  at: string;
  by?: string;
  reason?: string;
}

export interface Packet {
  id: string;
  title: string;
  summary?: string;
  source_run_ids: string[];
  accepted_finding_ids: string[];
  created_by: string;
  created_at: string;
  pin: HandoffPin;
  tasks: PacketTask[];
  order_hint?: string[];
  target: HandoffTarget;
  approval: HandoffApproval;
  status: PacketStatus;
  state?: PacketStatus;
  state_history: PacketStateHistoryEntry[];
  signers: Signer[];
  required_signers: number;
  execution_session_id?: string;
  execution_progress?: Record<string, TaskExecutionProgress>;
  execution_outcome?: Record<string, unknown>;
  // Legacy aliases during migration.
  target_profile?: string;
  executor_session_id?: string;
  convergence_count: number;
  updated_at: string;
}

interface HandoffSlice {
  packets: Map<string, Packet>;
  order: string[];
  activePacketId: string | null;
  upsert(p: Packet): void;
  setActive(id: string | null): void;
  setStatus(id: string, status: PacketStatus): void;
  addSigner(id: string, s: Signer): boolean; // false on self-sign conflict
  setExecutorSession(id: string, sessionId: string): void;
  setExecutionProgress(id: string, progress: TaskExecutionProgress): void;
  setExecutionOutcome(id: string, status: PacketStatus, outcome: Record<string, unknown>): void;
  incrementConvergence(id: string): void;
  clear(): void;
}

export const useHandoff = create<HandoffSlice>((set, get) => ({
  packets: new Map(),
  order: [],
  activePacketId: null,

  upsert(p) {
    set((s) => {
      const packets = new Map(s.packets);
      const order = packets.has(p.id) ? s.order : [...s.order, p.id];
      packets.set(p.id, { ...p, updated_at: p.updated_at ?? new Date().toISOString() });
      return {
        packets,
        order,
        activePacketId: s.activePacketId ?? p.id,
      };
    });
  },

  setActive(id) {
    set({ activePacketId: id });
  },

  setStatus(id, status) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const lastState = cur.state_history?.[cur.state_history.length - 1]?.state;
      if (lastState === status) return s;
      const packets = new Map(s.packets);
      packets.set(id, {
        ...cur,
        status,
        state: status,
        state_history: [
          ...(cur.state_history ?? []),
          { state: status, at: new Date().toISOString() },
        ],
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
  },

  addSigner(id, signer) {
    const cur = get().packets.get(id);
    if (!cur) return true;
    if (cur.signers.some((x) => x.name === signer.name)) return false;
    set((s) => {
      const packets = new Map(s.packets);
      const curr = packets.get(id);
      if (!curr) return s;
      packets.set(id, {
        ...curr,
        signers: [...curr.signers, signer],
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
    return true;
  },

  setExecutorSession(id, sessionId) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      packets.set(id, {
        ...cur,
        execution_session_id: sessionId,
        executor_session_id: sessionId,
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
  },

  setExecutionProgress(id, progress) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      const existing = cur.execution_progress ?? {};
      packets.set(id, {
        ...cur,
        execution_progress: {
          ...existing,
          [progress.task_id]: progress,
        },
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
  },

  setExecutionOutcome(id, status, outcome) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      const outcomeStatus =
        typeof outcome.status === 'string' ? outcome.status : status === 'failed' ? 'failed' : '';
      const packetStatus: PacketStatus =
        outcomeStatus === 'failed' || outcomeStatus === 'cancelled' ? 'failed' : status;
      const lastState = cur.state_history?.[cur.state_history.length - 1]?.state;
      const nextStateHistory =
        lastState === status
          ? cur.state_history
          : [
              ...(cur.state_history ?? []),
              {
                state: status,
                at: new Date().toISOString(),
                reason: `execution_${outcomeStatus || status}`,
              },
            ];
      packets.set(id, {
        ...cur,
        status: packetStatus,
        state: packetStatus,
        state_history: nextStateHistory,
        execution_outcome: outcome,
        updated_at: new Date().toISOString(),
      });
      return { packets };
    });
  },

  incrementConvergence(id) {
    set((s) => {
      const cur = s.packets.get(id);
      if (!cur) return s;
      const packets = new Map(s.packets);
      packets.set(id, { ...cur, convergence_count: cur.convergence_count + 1 });
      return { packets };
    });
  },

  clear() {
    set({ packets: new Map(), order: [], activePacketId: null });
  },
}));
