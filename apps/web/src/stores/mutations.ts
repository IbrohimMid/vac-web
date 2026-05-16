// Mutation inbox store: tracks pending mutation intents emitted by the local
// bridge before they are applied. Phase B1 (Sprint B) only ingests the
// `bridge.mutation.requested` event into a store-backed queue; Phase B2 adds
// the approval action surface and B3 wires the apply / failed lifecycle.
//
// This store is the single source of truth for the MutationInbox surface
// (lands in Phase B2) and any downstream correlator (ReviewQueue, TaskBoard,
// AuditTrail).

import { create } from 'zustand';

export type MutationKind =
  | 'write'
  | 'edit'
  | 'delete'
  | 'rename'
  | 'bash'
  | 'unknown';

export type MutationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'superseded';

export const MUTATION_KINDS: ReadonlyArray<MutationKind> = Object.freeze([
  'write',
  'edit',
  'delete',
  'rename',
  'bash',
  'unknown',
]);

export const MUTATION_STATUSES: ReadonlyArray<MutationStatus> = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'applying',
  'applied',
  'failed',
  'superseded',
]);

export interface MutationIntent {
  requestId: string;
  kind: MutationKind;
  summary: string;
  rationale?: string;
  targetPath?: string;
  diffPreview?: string;
  originatingTaskId?: string;
  originatingSessionId?: string;
  receivedAt: number;
  status: MutationStatus;
  statusMessage?: string;
  statusUpdatedAt?: number;
  // Source event type (audit-friendly: distinguishes 'bridge.mutation.requested'
  // from any future re-issue / refine event).
  sourceEventType: string;
}

interface MutationsSlice {
  intents: Record<string, MutationIntent>;
  // request_id insertion order, newest last. Surfaces should render reversed.
  order: string[];
  upsert(intent: MutationIntent): void;
  setStatus(requestId: string, status: MutationStatus, message?: string): void;
  remove(requestId: string): void;
  clear(): void;
}

export const useMutations = create<MutationsSlice>((set) => ({
  intents: {},
  order: [],

  upsert(intent) {
    set((s) => {
      const existing = s.intents[intent.requestId];
      const stamped: MutationIntent = {
        ...intent,
        statusUpdatedAt: intent.statusUpdatedAt ?? Date.now(),
      };
      const intents = {
        ...s.intents,
        [intent.requestId]: existing ? { ...existing, ...stamped } : stamped,
      };
      const order = existing ? s.order : [...s.order, intent.requestId];
      return { intents, order };
    });
  },

  setStatus(requestId, status, message) {
    set((s) => {
      const cur = s.intents[requestId];
      if (!cur) return s;
      const nextMessage = message ?? cur.statusMessage;
      const next: MutationIntent = {
        ...cur,
        status,
        statusUpdatedAt: Date.now(),
        ...(nextMessage !== undefined ? { statusMessage: nextMessage } : {}),
      };
      return {
        intents: {
          ...s.intents,
          [requestId]: next,
        },
      };
    });
  },

  remove(requestId) {
    set((s) => {
      if (!(requestId in s.intents)) return s;
      const intents = { ...s.intents };
      delete intents[requestId];
      return {
        intents,
        order: s.order.filter((id) => id !== requestId),
      };
    });
  },

  clear() {
    set({ intents: {}, order: [] });
  },
}));

// Render-time selector: stable list view of intents in insertion order.
export function mutationIntentList(
  state: Pick<MutationsSlice, 'intents' | 'order'>,
): MutationIntent[] {
  return state.order
    .map((id) => state.intents[id])
    .filter((x): x is MutationIntent => Boolean(x));
}
