// Persisted session history store (Phase 3 of durable-session-history).
//
// Backed by `session.history.list` / `session.history.listed` over the
// bridge WS. Distinct from `useSessions` (which only tracks live
// sessions) — every row here corresponds to a `meta.json` on disk and
// may or may not also have a live counterpart.

import { create } from 'zustand';

export type PersistedStatus = 'active' | 'closed' | 'failed' | 'forgotten';

export interface PersistentSessionRow {
  vac_session_id: string;
  agent_session_id: string | null;
  agent_id: string;
  agent_kind: string;
  project_root: string;
  profile_id: string;
  workflow_id: string | null;
  created_at: string;
  updated_at: string;
  status: PersistedStatus;
  native_resume_supported: boolean;
}

export type ResumeMode = 'replay_only' | 'acp_load' | 'native_or_replay';

/**
 * Stage X6 4-5 — extended progress states for the resume status chip.
 * Server emits the following events that drive these transitions:
 *   - `session.resume.started`           → `starting` (mode known)
 *   - `session.initializing` (synthetic) → `initializing`
 *   - `vac.session_resumed_native`       → `loading_native`
 *   - first replayed `engine.event` after `resume.started` → `replaying`
 *   - `session.resumed { native, resume_mode }`  → `resumed`
 *   - `session.resume.failed { reason }`        → `failed`
 *
 * The terminal `resumed.mode` is the **effective** mode (`native`,
 * `replay_only`, or `replay_only_fallback`) – not the requested mode –
 * so the chip can distinguish a user-requested replay from a fallback.
 */
export type EffectiveResumeMode =
  | 'native'
  | 'replay_only'
  | 'replay_only_fallback';

export type ResumeStatus =
  | { kind: 'idle' }
  | { kind: 'starting'; vac_session_id: string; mode: ResumeMode }
  | { kind: 'initializing'; vac_session_id: string; mode: ResumeMode }
  | { kind: 'loading_native'; vac_session_id: string }
  | {
      kind: 'replaying';
      vac_session_id: string;
      mode: ResumeMode;
      replayed: number;
    }
  | {
      kind: 'resumed';
      vac_session_id: string;
      mode: EffectiveResumeMode;
      native: boolean;
      replayed: number;
      finishedAt: string;
    }
  | {
      kind: 'failed';
      vac_session_id: string;
      reason: string;
      detail?: string;
    };

export interface ResumeWarning {
  vac_session_id: string;
  reason: string;
  detail?: string;
  at: string;
}

/**
 * Stage X6 P2-B — persistence health surface for the cockpit chip.
 * Drawn from two sources, in priority order:
 *   1. Live `session.persistence_degraded` ServerEvents (sticky once
 *      received until the user explicitly clears or a fresh `listed`
 *      payload says `healthy`).
 *   2. The `health` field on the `session.history.listed` payload
 *      (snapshot from the bridge's `AppState.persistence_health`).
 */
export type PersistenceHealthState = 'healthy' | 'degraded';

/**
 * Stage X6 P2-B — most recent persistence failure observed by the FE
 * (either from the listed payload's `recent_failures` or a single
 * `session.persistence_degraded` ServerEvent). Kept on the store so
 * the chip's tooltip / future details panel can show *why* the chip
 * is lit without needing another round trip.
 */
export interface PersistenceFailure {
  reason: string;
  detail: string;
  vac_session_id: string | null;
  at: string;
}

interface SessionHistorySlice {
  rows: PersistentSessionRow[];
  persistence: 'unknown' | 'disabled' | 'file';
  /** Stage X6 P2-B — snapshot of bridge persistence health. */
  health: PersistenceHealthState;
  /** Stage X6 P2-B — most recent failures (ring-capped on the bridge). */
  recentFailures: PersistenceFailure[];
  resume: ResumeStatus;
  /** Non-terminal resume warnings keyed by persisted session id. */
  resumeWarnings: Record<string, ResumeWarning>;
  /** Most recent resume warning, used by global status surfaces. */
  lastWarning: ResumeWarning | null;
  setRows(
    rows: PersistentSessionRow[],
    persistence: 'disabled' | 'file',
    health?: PersistenceHealthState,
    recentFailures?: PersistenceFailure[],
  ): void;
  /** Stage X6 P2-B — surface a live degraded ServerEvent. */
  recordPersistenceFailure(failure: PersistenceFailure): void;
  recordResumeWarning(warning: ResumeWarning): void;
  remove(vac_session_id: string): void;
  setResume(status: ResumeStatus): void;
  clear(): void;
}

export const useSessionHistory = create<SessionHistorySlice>((set) => ({
  rows: [],
  persistence: 'unknown',
  health: 'healthy',
  recentFailures: [],
  resume: { kind: 'idle' },
  resumeWarnings: {},
  lastWarning: null,
  setRows(rows, persistence, health, recentFailures) {
    set({
      rows,
      persistence,
      health: health ?? 'healthy',
      recentFailures: recentFailures ?? [],
    });
  },
  recordPersistenceFailure(failure) {
    set((s) => ({
      health: 'degraded',
      // Cap at 16 to mirror PERSISTENCE_HEALTH_RING_CAP on the bridge
      // so the FE never balloons memory on a chronically degraded
      // store.
      recentFailures: [failure, ...s.recentFailures].slice(0, 16),
    }));
  },
  recordResumeWarning(warning) {
    set((s) => ({
      resumeWarnings: {
        ...s.resumeWarnings,
        [warning.vac_session_id]: warning,
      },
      lastWarning: warning,
    }));
  },
  remove(vac_session_id) {
    set((s) => {
      const { [vac_session_id]: _removed, ...resumeWarnings } = s.resumeWarnings;
      return {
        rows: s.rows.filter((r) => r.vac_session_id !== vac_session_id),
        resumeWarnings,
        lastWarning:
          s.lastWarning?.vac_session_id === vac_session_id ? null : s.lastWarning,
      };
    });
  },
  setResume(status) {
    set({ resume: status });
  },
  clear() {
    set({
      rows: [],
      resume: { kind: 'idle' },
      resumeWarnings: {},
      lastWarning: null,
      health: 'healthy',
      recentFailures: [],
    });
  },
}));
