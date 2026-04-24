// Workbench tab selector. Phase 3+ tabs live here (transcript is the default).
// Single-select: only one tab visible at a time in the primary pane.

import { create } from 'zustand';

export type WorkbenchTab =
  | 'transcript'
  | 'approvals'
  | 'review'
  | 'readiness'
  | 'handoff'
  | 'release'
  | 'migration'
  | 'archive'
  | 'sessions'
  | 'runtime'
  | 'connectors';

interface WorkbenchSlice {
  active: WorkbenchTab;
  select(tab: WorkbenchTab): void;
}

export const useWorkbench = create<WorkbenchSlice>((set) => ({
  active: 'transcript',
  select(tab) {
    set({ active: tab });
  },
}));
