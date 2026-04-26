// Approvals store. Pending approval list + resolved history.
//
// Multi-client: the bridge is authoritative. Local optimistic state is cleared
// by the authoritative `approval.resolved` event (first decision wins; losers
// see the same resolution arrive and converge).

import { create } from 'zustand';

export type RiskLevel = 'low' | 'medium' | 'high';
export type Decision = 'approved' | 'rejected' | 'expired';

export interface ApprovalOption {
  optionId: string;
  kind: string;
  name: string;
}

interface ApprovalBase {
  approvalId: string;
  toolCallId: string;
  tool: string;
  risk: RiskLevel;
  summary: string;
  args: Record<string, unknown>;
  createdAt: string;
  sourceEventType: string;
  toolCall: Record<string, unknown>;
}

export interface ApprovalRequest extends ApprovalBase {
  state: 'pending' | 'deciding';
  expiresInMs: number | null;
  options: ApprovalOption[];
}

export interface ApprovalResolution extends ApprovalBase {
  state: 'resolved';
  resolvedAt: string;
  decision: Decision;
  outcome: string;
  optionId?: string;
  options: ApprovalOption[];
}

export interface ApprovalResolutionInput {
  approvalId: string;
  decision: Decision;
  outcome: string;
  optionId?: string;
  resolvedAt?: string;
  sourceEventType: string;
}

interface ApprovalsSlice {
  pending: Map<string, ApprovalRequest>;
  pendingOrder: string[];
  resolved: Map<string, ApprovalResolution>;
  resolvedOrder: string[];
  upsertPending(tc: ApprovalRequest): void;
  markDeciding(approvalId: string): void;
  resolve(resolution: ApprovalResolutionInput): void;
  clear(): void;
}

export const useApprovals = create<ApprovalsSlice>((set) => ({
  pending: new Map(),
  pendingOrder: [],
  resolved: new Map(),
  resolvedOrder: [],

  upsertPending(tc) {
    set((s) => {
      const pending = new Map(s.pending);
      const pendingOrder = pending.has(tc.approvalId) ? s.pendingOrder : [...s.pendingOrder, tc.approvalId];
      pending.set(tc.approvalId, tc);
      return { pending, pendingOrder };
    });
  },

  markDeciding(approvalId) {
    set((s) => {
      const cur = s.pending.get(approvalId);
      if (!cur || cur.state !== 'pending') return s;
      const pending = new Map(s.pending);
      pending.set(approvalId, { ...cur, state: 'deciding' });
      return { pending };
    });
  },

  resolve(resolution) {
    set((s) => {
      const pending = new Map(s.pending);
      const prior = pending.get(resolution.approvalId) ?? s.resolved.get(resolution.approvalId);
      pending.delete(resolution.approvalId);
      const pendingOrder = s.pendingOrder.filter((x) => x !== resolution.approvalId);
      const resolved = new Map(s.resolved);
      const resolvedOrder = resolved.has(resolution.approvalId)
        ? s.resolvedOrder.filter((x) => x !== resolution.approvalId)
        : [...s.resolvedOrder];
      const resolvedAt = resolution.resolvedAt ?? new Date().toISOString();
      const base: ApprovalResolution = prior
        ? {
            approvalId: prior.approvalId,
            toolCallId: prior.toolCallId,
            tool: prior.tool,
            risk: prior.risk,
            summary: prior.summary,
            args: prior.args,
            createdAt: prior.createdAt,
            sourceEventType: resolution.sourceEventType,
            toolCall: prior.toolCall,
            state: 'resolved',
            resolvedAt,
            decision: resolution.decision,
            outcome: resolution.outcome,
            ...(resolution.optionId !== undefined && { optionId: resolution.optionId }),
            options: 'options' in prior ? prior.options : [],
          }
        : {
            approvalId: resolution.approvalId,
            toolCallId: resolution.approvalId,
            tool: resolution.approvalId,
            risk: 'medium',
            summary: '',
            args: {},
            createdAt: resolvedAt,
            sourceEventType: resolution.sourceEventType,
            toolCall: {},
            state: 'resolved',
            resolvedAt,
            decision: resolution.decision,
            outcome: resolution.outcome,
            ...(resolution.optionId !== undefined && { optionId: resolution.optionId }),
            options: [],
          };
      resolved.set(resolution.approvalId, base);
      resolvedOrder.push(resolution.approvalId);
      return { pending, pendingOrder, resolved, resolvedOrder };
    });
  },

  clear() {
    set({
      pending: new Map(),
      pendingOrder: [],
      resolved: new Map(),
      resolvedOrder: [],
    });
  },
}));
