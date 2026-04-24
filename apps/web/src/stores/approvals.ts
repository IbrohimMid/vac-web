// Approvals store. Pending tool-call list + decided set.
//
// Multi-client: the bridge is authoritative. Local optimistic state is cleared
// by the authoritative `tool_call.decided` event (first decision wins; losers
// see the same resolution arrive and converge).

import { create } from 'zustand';

export type RiskLevel = 'low' | 'medium' | 'high';
export type Decision = 'approved' | 'rejected';

export interface ToolCall {
  id: string;
  tool: string;
  risk: RiskLevel;
  summary: string;
  args: Record<string, unknown>;
  createdAt: string;
  state: 'pending' | 'deciding' | 'decided';
  decision?: Decision;
}

interface ApprovalsSlice {
  pending: Map<string, ToolCall>;
  order: string[];
  decided: Map<string, Decision>;
  upsertPending(tc: ToolCall): void;
  markDeciding(id: string): void;
  resolve(id: string, decision: Decision): void;
  clear(): void;
}

export const useApprovals = create<ApprovalsSlice>((set) => ({
  pending: new Map(),
  order: [],
  decided: new Map(),

  upsertPending(tc) {
    set((s) => {
      const pending = new Map(s.pending);
      const order = pending.has(tc.id) ? s.order : [...s.order, tc.id];
      pending.set(tc.id, tc);
      return { pending, order };
    });
  },

  markDeciding(id) {
    set((s) => {
      const cur = s.pending.get(id);
      if (!cur || cur.state !== 'pending') return s;
      const pending = new Map(s.pending);
      pending.set(id, { ...cur, state: 'deciding' });
      return { pending };
    });
  },

  resolve(id, decision) {
    set((s) => {
      const pending = new Map(s.pending);
      pending.delete(id);
      const order = s.order.filter((x) => x !== id);
      const decided = new Map(s.decided);
      decided.set(id, decision);
      return { pending, order, decided };
    });
  },

  clear() {
    set({ pending: new Map(), order: [], decided: new Map() });
  },
}));
