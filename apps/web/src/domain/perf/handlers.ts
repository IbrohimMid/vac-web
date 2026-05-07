// Wire perf.* transport events into the perf store.
// Producer: apps/local-bridge/src/perf.rs.

import { usePerf } from '../../stores/perf';
import type { TransportHandle } from '../../transport';
import {
  asPerfEntry,
  asPerfRegression,
  isPerfStatus,
  type PerfRegression,
  type PerfRunCompletedPayload,
} from './types';

export function registerPerfHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('perf.run_completed', (ev) => {
      const p = ev.payload as Partial<PerfRunCompletedPayload> | null;
      if (!p) return;
      const status = isPerfStatus(p.status) ? p.status : 'unknown';
      const latest = p.latest != null ? asPerfEntry(p.latest) : null;
      const regressions = Array.isArray(p.regressions)
        ? p.regressions
            .map(asPerfRegression)
            .filter((r): r is PerfRegression => r !== null)
        : [];
      usePerf.getState().setSnapshot({ status, latest, regressions });
    }),
  );

  return () => offs.forEach((off) => off());
}
