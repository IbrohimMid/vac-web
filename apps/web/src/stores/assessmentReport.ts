// Assessment report selection slice — Stage J.
//
// Domain-distinct from useAttachments (which is composer chat context). This
// slice owns:
//   - which run is currently being viewed in report-detail mode
//     (`reportRunId: string | null`),
//   - which findings the user selected for an upcoming handoff
//     (`selectedFindingIds: Set<string>`).
//
// HandoffBuilder reads `selectedFindingIds` on mount to pre-fill its picker.
// The set survives the toggle out of report mode so users can navigate
// without losing selection state.

import { create } from 'zustand';

interface AssessmentReportSlice {
  reportRunId: string | null;
  selectedFindingIds: Set<string>;

  enterReport(runId: string): void;
  exitReport(): void;
  toggleFinding(id: string): void;
  setSelected(ids: ReadonlyArray<string>): void;
  clearSelection(): void;
  clear(): void;
}

export const useAssessmentReport = create<AssessmentReportSlice>((set) => ({
  reportRunId: null,
  selectedFindingIds: new Set(),

  enterReport(runId) {
    set({ reportRunId: runId });
  },

  exitReport() {
    set({ reportRunId: null });
  },

  toggleFinding(id) {
    set((s) => {
      const next = new Set(s.selectedFindingIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedFindingIds: next };
    });
  },

  setSelected(ids) {
    set({ selectedFindingIds: new Set(ids) });
  },

  clearSelection() {
    set({ selectedFindingIds: new Set() });
  },

  clear() {
    set({ reportRunId: null, selectedFindingIds: new Set() });
  },
}));
