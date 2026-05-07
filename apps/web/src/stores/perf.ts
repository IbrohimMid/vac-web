// Perf store: caches the latest perf.run_completed snapshot from the bridge.
//
// Driven by perf.run_completed frames (see apps/web/src/domain/perf/handlers.ts).
// PerfBadge calls requestLatest(transport) on mount; bridge replies via
// perf.latest_run command + perf.run_completed event.
//
// Slice F5c-web (2026-05-07): perf.latest_run is sessionless (scope: sessionless),
// so we dispatch with sessionId='' (empty string).

import { create } from 'zustand';
import type {
  PerfEntry,
  PerfRegression,
  PerfRunCompletedPayload,
  PerfStatus,
} from '../domain/perf/types';
import type { TransportHandle } from '../transport';

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PerfSlice {
  status: PerfStatus;
  latest: PerfEntry | null;
  regressions: PerfRegression[];
  requestStatus: RequestStatus;
  error: string | null;
  lastUpdated: string | null;

  setSnapshot(payload: PerfRunCompletedPayload): void;
  setStatus(status: RequestStatus, error?: string | null): void;
  clear(): void;

  requestLatest(transport: TransportHandle | null): Promise<boolean>;
}

function errMessage(
  ack: { error?: { message?: string } | null },
  fallback: string,
): string {
  return ack.error?.message ?? fallback;
}

export const usePerf = create<PerfSlice>((set, get) => ({
  status: 'unknown',
  latest: null,
  regressions: [],
  requestStatus: 'idle',
  error: null,
  lastUpdated: null,

  setSnapshot(payload) {
    set({
      status: payload.status,
      latest: payload.latest,
      regressions: payload.regressions,
      requestStatus: 'ready',
      error: null,
      lastUpdated: new Date().toISOString(),
    });
  },

  setStatus(requestStatus, error = null) {
    set({ requestStatus, error });
  },

  clear() {
    set({
      status: 'unknown',
      latest: null,
      regressions: [],
      requestStatus: 'idle',
      error: null,
      lastUpdated: null,
    });
  },

  async requestLatest(transport) {
    if (!transport) {
      get().setStatus('error', 'no transport');
      return false;
    }
    get().setStatus('loading');
    const ack = await transport.send('', 'perf.latest_run', {});
    if (!ack.ok) {
      get().setStatus('error', errMessage(ack, 'perf.latest_run failed'));
      return false;
    }
    // requestStatus flips to 'ready' when perf.run_completed lands.
    return true;
  },
}));
