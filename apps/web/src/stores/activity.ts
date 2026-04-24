import { create } from 'zustand';
import type { Severity } from '../components/SeverityIcon';

export interface ActivityEntry {
  id: string;
  ts: string;
  subsystem: string;
  severity: Severity;
  summary: string;
  actionId?: string;
}

interface ActivitySlice {
  entries: ActivityEntry[];
  append(e: ActivityEntry): void;
  clear(): void;
}

const MAX_ENTRIES = 1000;

export const useActivity = create<ActivitySlice>((set) => ({
  entries: [],
  append(e) {
    set((s) => ({ entries: [e, ...s.entries].slice(0, MAX_ENTRIES) }));
  },
  clear() {
    set({ entries: [] });
  },
}));
