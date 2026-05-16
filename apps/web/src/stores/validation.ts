import { create } from 'zustand';

export type ValidationRunStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled';

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
  {
    id: 'e2e-web',
    label: 'Web e2e',
    command: 'VAC_WEB_E2E_PORT=4183 pnpm -F web test:e2e',
    heavy: true,
  },
  { id: 'diff-check', label: 'Diff whitespace check', command: 'git diff --check' },
];

function isPresetShape(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.label !== 'string' || r.label.length === 0) return false;
  if (typeof r.command !== 'string' || r.command.length === 0) return false;
  return true;
}

/**
 * Parse a JSON string or array into ValidationPreset[]. Returns null if the
 * input is empty/invalid or contains no usable entries.
 */
export function parseValidationPresets(raw: unknown): ValidationPreset[] | null {
  if (typeof raw === 'string') {
    if (raw.length === 0) return null;
    try {
      return parseValidationPresets(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  const out: ValidationPreset[] = [];
  for (const item of raw) {
    if (!isPresetShape(item)) continue;
    const p: ValidationPreset = {
      id: item.id as string,
      label: item.label as string,
      command: item.command as string,
    };
    if ((item as { heavy?: unknown }).heavy === true) p.heavy = true;
    out.push(p);
  }
  return out.length > 0 ? out : null;
}

export function resolveInitialPresets(): ValidationPreset[] {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const raw = env?.VITE_VAC_VALIDATION_PRESETS;
  const parsed = typeof raw === 'string' ? parseValidationPresets(raw) : null;
  return parsed ?? DEFAULT_VALIDATION_PRESETS;
}

interface ValidationSlice {
  runs: Map<string, ValidationRun>;
  order: string[];
  selectedRunId: string | null;
  presets: ValidationPreset[];
  upsertRun(run: ValidationRun): void;
  setSelectedRun(id: string | null): void;
  setPresets(presets: ValidationPreset[]): void;
  cancelRun(runId: string): void;
  clearSession(sessionId: string): void;
  resetAll(): void;
}

export const useValidation = create<ValidationSlice>((set) => ({
  runs: new Map(),
  order: [],
  selectedRunId: null,
  presets: resolveInitialPresets(),

  upsertRun(run) {
    set((s) => {
      const runs = new Map(s.runs);
      const exists = runs.has(run.id);
      const previous = runs.get(run.id);
      const next = previous
        ? { ...previous, ...run, relatedFiles: run.relatedFiles }
        : run;
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

  setPresets(presets) {
    set({ presets: presets.slice() });
  },

  cancelRun(runId) {
    set((s) => {
      const previous = s.runs.get(runId);
      if (!previous) return s;
      if (
        previous.status === 'passed' ||
        previous.status === 'failed' ||
        previous.status === 'cancelled'
      ) {
        return s;
      }
      const runs = new Map(s.runs);
      const finishedAt = previous.finishedAt ?? new Date().toISOString();
      runs.set(runId, { ...previous, status: 'cancelled', finishedAt });
      return { runs };
    });
  },

  clearSession(sessionId) {
    set((s) => {
      const runs = new Map(s.runs);
      for (const [id, run] of runs) {
        if (run.sessionId === sessionId) runs.delete(id);
      }
      const order = s.order.filter((id) => runs.has(id));
      const selectedRunId =
        s.selectedRunId && runs.has(s.selectedRunId)
          ? s.selectedRunId
          : (order[0] ?? null);
      return { runs, order, selectedRunId };
    });
  },

  resetAll() {
    set({
      runs: new Map(),
      order: [],
      selectedRunId: null,
      presets: resolveInitialPresets(),
    });
  },
}));

export function selectSessionValidationRuns(
  sessionId: string | null,
): ValidationRun[] {
  const state = useValidation.getState();
  if (!sessionId) return [];
  return state.order
    .map((id) => state.runs.get(id))
    .filter((run): run is ValidationRun => !!run && run.sessionId === sessionId);
}
