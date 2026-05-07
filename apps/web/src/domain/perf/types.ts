// Types mirror the bridge's perf.run_completed payload.
// Producer: apps/local-bridge/src/perf.rs (Slice F5c-CI).

export type PerfStatus = 'unknown' | 'ok' | 'warn' | 'crit';

export type PerfMeasurements = Record<string, Record<string, number>>;

export interface PerfEntry {
  recorded_at: string;
  commit: string | null;
  ref: string | null;
  run_id: string | null;
  measurements: PerfMeasurements;
}

export interface PerfRegression {
  measurement: string;
  metric: string;
  latest: number;
  baseline: number;
  delta_pct: number;
}

export interface PerfRunCompletedPayload {
  status: PerfStatus;
  latest: PerfEntry | null;
  regressions: PerfRegression[];
}

export function isPerfStatus(v: unknown): v is PerfStatus {
  return v === 'unknown' || v === 'ok' || v === 'warn' || v === 'crit';
}

export function asPerfEntry(raw: unknown): PerfEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.recorded_at !== 'string') return null;
  const measurements =
    r.measurements && typeof r.measurements === 'object'
      ? (r.measurements as PerfMeasurements)
      : {};
  return {
    recorded_at: r.recorded_at,
    commit: typeof r.commit === 'string' ? r.commit : null,
    ref: typeof r.ref === 'string' ? r.ref : null,
    run_id: typeof r.run_id === 'string' ? r.run_id : null,
    measurements,
  };
}

export function asPerfRegression(raw: unknown): PerfRegression | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.measurement !== 'string') return null;
  if (typeof r.metric !== 'string') return null;
  if (typeof r.latest !== 'number') return null;
  if (typeof r.baseline !== 'number') return null;
  if (typeof r.delta_pct !== 'number') return null;
  return {
    measurement: r.measurement,
    metric: r.metric,
    latest: r.latest,
    baseline: r.baseline,
    delta_pct: r.delta_pct,
  };
}
