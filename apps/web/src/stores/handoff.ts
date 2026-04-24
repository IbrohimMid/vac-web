// Handoff packet store. Spec: docs/handoff-contract.md.
//
// A packet bundles a set of findings → tasks pinned against a worktree digest
// + base SHA + connector snapshots. Two-party approval: authoring ≠ approving.
// Dispatch re-verifies the pin; drift → `handoff.invalidated`.
//
// Convergence guard: persistent+regressed counts tracked across handoff→reassess
// cycles; 3 cycles without strictly-decreasing count fires a sticky banner.

import { create } from 'zustand';

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

export interface Pin {
  worktree_digest: string;
  base_sha: string;
  captured_at: string;
  policy: PinPolicy;
  connector_snapshots: Array<{ connector: string; snapshot_id: string }>;
}

export interface PacketTask {
  id: string;
  title: string;
  finding_ids: string[];
  requires_approval_per_step: boolean;
  constraint: string;
}

export interface Signer {
  name: string;
  role: 'author' | 'approver';
  signed_at: string;
  reason?: string;
}

export interface Packet {
  id: string;
  title: string;
  target_profile: string;
  status: PacketStatus;
  tasks: PacketTask[];
  pin: Pin;
  signers: Signer[];
  required_signers: number;
  executor_session_id?: string;
  convergence_count: number;
  created_at: string;
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
      const packets = new Map(s.packets);
      packets.set(id, { ...cur, status, updated_at: new Date().toISOString() });
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
      packets.set(id, { ...cur, executor_session_id: sessionId });
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
