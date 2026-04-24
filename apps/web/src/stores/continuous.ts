// Continuous readiness store. Phase 8 anchors:
//  - Stage triggers arrive as `orchestrator.trigger_fired` events.
//  - Continuous mode cron-ticks fire `continuous.cadence_tick`.
//  - Debounce + input-surface invalidation decide whether a trigger schedules
//    a real assessment.run or emits `orchestrator.run_skipped`.
//
// Policy lives in code here (web + bridge both apply it). The bridge is
// authoritative; the web store mirrors the decision stream so the Continuous
// dashboard stays explainable.

import { create } from 'zustand';
import type { AssessorFamily } from './assessment';

export type TriggerSource =
  | 'pr.merged'
  | 'branch.pushed'
  | 'ci.green'
  | 'ci.red'
  | 'connector.health.degraded'
  | 'cadence.cron';

/**
 * Canonical trigger → family routing, per `docs/plans/phase-8/README.md`.
 * Table is data, not code — new sources extend it without changing the
 * dispatcher. `null` means "all configured families" (cadence-driven).
 */
export const TRIGGER_ROUTING: Record<TriggerSource, AssessorFamily[] | null> = {
  'pr.merged': ['rtd', 'security', 'qa'],
  'branch.pushed': ['rtd', 'security'],
  'ci.green': ['release', 'performance'],
  'ci.red': ['rtd', 'reliability'],
  'connector.health.degraded': ['reliability', 'performance'],
  'cadence.cron': null,
};

export interface TriggerEvent {
  id: string;
  source: TriggerSource;
  fired_at: string;
  details?: string;
  scheduled_families: AssessorFamily[];
  /** `skipped` if debounce or input-surface invalidation suppressed the run. */
  decision: 'scheduled' | 'coalesced' | 'skipped';
  skip_reason?: string;
}

export interface FamilyCadence {
  family: AssessorFamily;
  cadence_seconds: number;
  last_run_at?: string;
  last_verdict?: 'pass' | 'warn' | 'fail' | 'unknown';
  input_patterns: string[];
}

interface ContinuousSlice {
  enabled: boolean;
  cadences: Map<AssessorFamily, FamilyCadence>;
  triggers: TriggerEvent[];
  setEnabled(enabled: boolean): void;
  setCadence(c: FamilyCadence): void;
  appendTrigger(ev: TriggerEvent): void;
  clear(): void;
}

const MAX_TRIGGERS = 200;

export const useContinuous = create<ContinuousSlice>((set) => ({
  enabled: false,
  cadences: new Map(),
  triggers: [],

  setEnabled(enabled) {
    set({ enabled });
  },

  setCadence(c) {
    set((s) => {
      const cadences = new Map(s.cadences);
      cadences.set(c.family, c);
      return { cadences };
    });
  },

  appendTrigger(ev) {
    set((s) => ({ triggers: [ev, ...s.triggers].slice(0, MAX_TRIGGERS) }));
  },

  clear() {
    set({ enabled: false, cadences: new Map(), triggers: [] });
  },
}));

/** Families a given trigger would fire, resolved against active cadences. */
export function familiesForTrigger(
  source: TriggerSource,
  enabled: Set<AssessorFamily>,
): AssessorFamily[] {
  const routed = TRIGGER_ROUTING[source];
  if (routed === null) {
    return Array.from(enabled);
  }
  return routed.filter((f) => enabled.has(f));
}

/**
 * Debounce decision. Coalesce events of the same source within `windowMs`
 * by returning `'coalesced'` when the previous scheduled run is newer than
 * the cutoff.
 */
export function debounceDecision(
  now: number,
  lastScheduledAt: number | null,
  windowMs: number,
): 'scheduled' | 'coalesced' {
  if (lastScheduledAt === null) return 'scheduled';
  return now - lastScheduledAt < windowMs ? 'coalesced' : 'scheduled';
}

/**
 * Input-surface invalidation. Returns true when none of the candidate changed
 * file paths matches any of the family's declared input patterns — a skip is
 * safe because no ingest material changed. Pattern is a simple `*` glob.
 */
export function inputSurfaceSkip(
  changedPaths: string[],
  inputPatterns: string[],
): boolean {
  if (inputPatterns.length === 0) return false; // conservative: no patterns = always run
  if (changedPaths.length === 0) return true; // nothing changed — safe skip
  const regexes = inputPatterns.map(globToRegex);
  return !changedPaths.some((p) => regexes.some((r) => r.test(p)));
}

function globToRegex(glob: string): RegExp {
  // Minimal glob → regex; supports `*`, `**`, path separators. Not a full
  // gitignore — good enough for pattern families like `apps/web/src/**`.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp('^' + escaped + '$');
}
