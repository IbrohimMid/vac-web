import { create } from 'zustand';

export type ValidationRunStatus = 'idle' | 'running' | 'passed' | 'failed';

export interface ValidationRun {
  id: string;
  sessionId: string;
  command: string;
  label: string;
  status: ValidationRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
  relatedFiles: string[];
  taskId?: string;
  sourceEventType?: string;
}

export interface ValidationPreset {
  id: string;
  label: string;
  command: string;
  heavy?: boolean;
}

export const DEFAULT_VALIDATION_PRESETS: ValidationPreset[] = [
  { id: 'typecheck', label: 'Typecheck', command: 'pnpm -F web typecheck' },
  { id: 'unit-web', label: 'Web unit tests', command: 'pnpm -F web test -- --run' },
  { id: 'e2e-web', label: 'Web e2e', command: 'VAC_WEB_E2E_PORT=4183 pnpm -F web test:e2e', heavy: true },
  { id: 'diff-check', label: 'Diff whitespace check', command: 'git diff --check' },
];

interface ValidationSlice {
  runs: Map<string, ValidationRun>;
  order: string[];
  selectedRunId: string | null;
  presets: ValidationPreset[];
  upsertRun(run: ValidationRun): void;
  setSelectedRun(id: string | null): void;
  clearSession(sessionId: string): void;
  resetAll(): void;
}

export const useValidation = create<ValidationSlice>((set) => ({
  runs: new Map(),
  order: [],
  selectedRunId: null,
  presets: DEFAULT_VALIDATION_PRESETS,

  upsertRun(run) {
    set((s) => {
      const runs = new Map(s.runs);
      const exists = runs.has(run.id);
      const previous = runs.get(run.id);
      const next = previous ? { ...previous, ...run, relatedFiles: run.relatedFiles } : run;
      runs.set(run.id, next);
      return {
        runs,
        order: exists ? s.order : [run.id, ...s.order],
        selectedRunId: s.selectedRunId ?? run.id,
      };
    });
  },

  setSelectedRun(id) {
    set({ selectedRunId: id });
  },

  clearSession(sessionId) {
    set((s) => {
      const runs = new Map(s.runs);
      for (const [id, run] of runs) {
        if (run.sessionId === sessionId) runs.delete(id);
      }
      const order = s.order.filter((id) => runs.has(id));
      const selectedRunId = s.selectedRunId && runs.has(s.selectedRunId) ? s.selectedRunId : (order[0] ?? null);
      return { runs, order, selectedRunId };
    });
  },

  resetAll() {
    set({ runs: new Map(), order: [], selectedRunId: null, presets: DEFAULT_VALIDATION_PRESETS });
  },
}));

export function selectSessionValidationRuns(sessionId: string | null): ValidationRun[] {
  const state = useValidation.getState();
  if (!sessionId) return [];
  return state.order.map((id) => state.runs.get(id)).filter((run): run is ValidationRun => !!run && run.sessionId === sessionId);
}
