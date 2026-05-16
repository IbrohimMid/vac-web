// Audit trail store — Sprint B Phase B4.
//
// Captures every bridge mutation transition (events from the bridge) and
// every user-initiated decision (approve / reject / refine / retry) into a
// bounded ring buffer. The browser surface (AuditTrail.tsx) is read-only:
// users can scroll history but never edit it. This is the source of truth
// the user sees when they ask "why is this intent in failed state?" or
// "who approved this mutation?".
//
// Buffer is bounded to AUDIT_CAP entries to keep memory predictable for
// long-running sessions. Older entries are dropped FIFO; we do not persist
// to disk in B4 (B5 will pipe to the local bridge audit shard).

import { create } from 'zustand';

export type AuditSource = 'bridge' | 'user' | 'system';

export interface AuditEntry {
  id: string;
  ts: number;
  source: AuditSource;
  kind: string;
  summary: string;
  requestId?: string;
  status?: string;
  detail?: string;
}

export const AUDIT_CAP = 200;

export type AuditEntryInput = Omit<AuditEntry, 'id' | 'ts'> & {
  id?: string;
  ts?: number;
};

interface AuditState {
  entries: AuditEntry[];
  append(entry: AuditEntryInput): void;
  clear(): void;
}

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % 1_000_000;
  return `audit-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export const useAudit = create<AuditState>((set) => ({
  entries: [],
  append: (input) =>
    set((state) => {
      const entry: AuditEntry = {
        id: input.id ?? nextId(),
        ts: input.ts ?? Date.now(),
        source: input.source,
        kind: input.kind,
        summary: input.summary,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.detail ? { detail: input.detail } : {}),
      };
      // newest-first ordering keeps the UI render trivial (slice from top).
      const next = [entry, ...state.entries];
      return { entries: next.length > AUDIT_CAP ? next.slice(0, AUDIT_CAP) : next };
    }),
  clear: () => set({ entries: [] }),
}));

// Convenience: select entries scoped to a single request id, in newest-first
// order. Returns a fresh array — wrap callers with useMemo if used inside
// a render selector (see React 19 selector stability rule).
export function auditEntriesForRequest(state: { entries: AuditEntry[] }, requestId: string): AuditEntry[] {
  return state.entries.filter((e) => e.requestId === requestId);
}
