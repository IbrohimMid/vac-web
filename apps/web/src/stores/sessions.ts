// Sessions list store (distinct from current-session). Populated by
// `session.list` response + `session.*` broadcast events.

import { create } from 'zustand';

export type SessionStatus = 'active' | 'paused' | 'closed';

export interface SessionRow {
  id: string;
  profile_id: string;
  project_root?: string;
  status: SessionStatus;
  model?: string;
  created_at: string;
  attached_clients: number;
}

interface SessionsSlice {
  rows: SessionRow[];
  setAll(rows: SessionRow[]): void;
  upsert(row: SessionRow): void;
  remove(id: string): void;
  clear(): void;
}

export const useSessions = create<SessionsSlice>((set) => ({
  rows: [],
  setAll(rows) {
    set({ rows });
  },
  upsert(row) {
    set((s) => {
      const idx = s.rows.findIndex((r) => r.id === row.id);
      if (idx < 0) return { rows: [...s.rows, row] };
      const next = s.rows.slice();
      next[idx] = row;
      return { rows: next };
    });
  },
  remove(id) {
    set((s) => ({ rows: s.rows.filter((r) => r.id !== id) }));
  },
  clear() {
    set({ rows: [] });
  },
}));
