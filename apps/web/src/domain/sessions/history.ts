// Wire `session.history.*` and replay-only `session.resume*` ServerEvents
// into the persistent-session-history store. Phase 3 of
// durable-session-history.

import {
  useSessionHistory,
  type ConfigDiagnostic,
  type EffectiveResumeMode,
  type PersistedStatus,
  type PersistenceFailure,
  type PersistenceHealthState,
  type PersistentSessionRow,
  type ResumeMode,
  type ResumePolicySnapshot,
} from '../../stores/sessionHistory';
import type { TransportHandle } from '../../transport';

function asStatus(raw: unknown): PersistedStatus {
  if (raw === 'active' || raw === 'closed' || raw === 'failed' || raw === 'forgotten')
    return raw;
  return 'active';
}

function asMode(raw: unknown): ResumeMode {
  if (raw === 'replay_only' || raw === 'acp_load' || raw === 'native_or_replay') return raw;
  return 'replay_only';
}

// Stage X6 4-5 — the terminal `resumed.mode` reported back by the bridge
// is the *effective* mode, which can be one of `native`, `replay_only`,
// or `replay_only_fallback` (when an `acp_load` request silently fell
// back to a persistence replay because the agent did not implement
// `session/load`). Older bridges may emit the requested mode here, in
// which case we coerce `acp_load`/`native_or_replay` to `native`/
// `replay_only` based on the `native` flag.
function asEffectiveMode(raw: unknown, native: boolean): EffectiveResumeMode {
  if (raw === 'native' || raw === 'replay_only' || raw === 'replay_only_fallback') return raw;
  if (raw === 'acp_load') return 'native';
  if (raw === 'native_or_replay') return native ? 'native' : 'replay_only_fallback';
  return native ? 'native' : 'replay_only';
}

interface RawHistoryRow {
  vac_session_id?: string;
  agent_session_id?: string | null;
  agent_id?: string;
  agent_kind?: string;
  project_root?: string;
  profile_id?: string;
  workflow_id?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: string;
  native_resume?: { load_session_supported?: boolean };
}

function coerce(row: RawHistoryRow): PersistentSessionRow | null {
  if (!row.vac_session_id) return null;
  return {
    vac_session_id: row.vac_session_id,
    agent_session_id: row.agent_session_id ?? null,
    agent_id: row.agent_id ?? 'unknown',
    agent_kind: row.agent_kind ?? 'unknown',
    project_root: row.project_root ?? '',
    profile_id: row.profile_id ?? 'unknown',
    workflow_id: row.workflow_id ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    status: asStatus(row.status),
    native_resume_supported: !!row.native_resume?.load_session_supported,
  };
}

export function registerSessionHistoryHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('session.history.listed', (ev) => {
      const p = ev.payload as
        | {
            sessions?: RawHistoryRow[];
            persistence?: 'disabled' | 'file';
            // Stage X6 P2-B — forward-compat optional fields. Older
            // bridges (pre-P2-B) won't include these; treat absence
            // as healthy so the chip stays dark.
            health?: 'healthy' | 'degraded';
            recent_failures?: Array<{
              reason?: string;
              detail?: string;
              vac_session_id?: string | null;
              at?: string;
            }>;
          }
        | null;
      if (!p) return;
      const rows = (p.sessions ?? [])
        .map(coerce)
        .filter((r): r is PersistentSessionRow => r !== null)
        // newest first
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      const health: PersistenceHealthState = p.health === 'degraded' ? 'degraded' : 'healthy';
      const recentFailures: PersistenceFailure[] = (p.recent_failures ?? []).map((r) => ({
        reason: r.reason ?? 'unknown',
        detail: r.detail ?? '',
        vac_session_id: r.vac_session_id ?? null,
        at: r.at ?? new Date().toISOString(),
      }));
      useSessionHistory.getState().setRows(rows, p.persistence ?? 'file', health, recentFailures);
    }),
  );

  // Stage X6 P2-B — live persistence-degraded signal. The sink emits
  // this on every append/save/forget failure, so the chip can flip
  // immediately without waiting for the next `session.history.list`
  // round trip.
  offs.push(
    transport.on('session.persistence_degraded', (ev) => {
      const p = ev.payload as
        | {
            vac_session_id?: string | null;
            reason?: string;
            detail?: string;
          }
        | null;
      if (!p) return;
      useSessionHistory.getState().recordPersistenceFailure({
        reason: p.reason ?? 'unknown',
        detail: p.detail ?? '',
        vac_session_id: p.vac_session_id ?? null,
        at: new Date().toISOString(),
      });
    }),
  );

  offs.push(
    transport.on('session.history.forgotten', (ev) => {
      const id = (ev.payload as { vac_session_id?: string } | null)?.vac_session_id;
      if (id) useSessionHistory.getState().remove(id);
    }),
  );

  offs.push(
    transport.on('session.resume.started', (ev) => {
      const p = ev.payload as { vac_session_id?: string; mode?: string } | null;
      if (!p?.vac_session_id) return;
      useSessionHistory.getState().setResume({
        kind: 'starting',
        vac_session_id: p.vac_session_id,
        mode: asMode(p.mode),
      });
    }),
  );

  // Stage X6 4-5 — promote `starting` to `loading_native` once the bridge
  // confirms the agent accepted `session/load`. Synthetic event fired from
  // `spawn_acp` after `AcpClient::load_session` returns Ok.
  offs.push(
    transport.on('vac.session_resumed_native', (ev) => {
      const p = ev.payload as { vac_session_id?: string } | null;
      const sid = p?.vac_session_id;
      if (!sid) return;
      useSessionHistory.getState().setResume({
        kind: 'loading_native',
        vac_session_id: sid,
      });
    }),
  );

  // Stage X6 4-5 — transition to `replaying` when the bridge starts
  // streaming buffered persistence events for a session that's currently
  // `starting` or `loading_native`. We watch `session.replay.progress`
  // (sent by the persistence sink in batches of N events) plus the
  // legacy in-band `session.history.replay.tick` for older bridges.
  const onReplayProgress = (ev: {
    payload: unknown;
  }) => {
    const p = ev.payload as
      | { vac_session_id?: string; replayed?: number; mode?: string }
      | null;
    const sid = p?.vac_session_id;
    if (!sid) return;
    const current = useSessionHistory.getState().resume;
    if (current.kind === 'idle' || current.kind === 'resumed' || current.kind === 'failed')
      return;
    if ('vac_session_id' in current && current.vac_session_id !== sid) return;
    const mode: ResumeMode =
      asMode(p.mode) ??
      ('mode' in current && current.mode ? (current.mode as ResumeMode) : 'replay_only');
    useSessionHistory.getState().setResume({
      kind: 'replaying',
      vac_session_id: sid,
      mode,
      replayed: typeof p.replayed === 'number' ? p.replayed : 0,
    });
  };
  offs.push(transport.on('session.replay.progress', onReplayProgress));
  offs.push(transport.on('session.history.replay.tick', onReplayProgress));

  offs.push(
    transport.on('session.resumed', (ev) => {
      const p = ev.payload as
        | {
            vac_session_id?: string;
            mode?: string;
            native?: boolean;
            resume_mode?: string;
            replayed_events?: number;
          }
        | null;
      if (!p?.vac_session_id) return;
      const native = !!p.native;
      useSessionHistory.getState().setResume({
        kind: 'resumed',
        vac_session_id: p.vac_session_id,
        mode: asEffectiveMode(p.resume_mode ?? p.mode, native),
        native,
        replayed: typeof p.replayed_events === 'number' ? p.replayed_events : 0,
        finishedAt: new Date().toISOString(),
      });
    }),
  );

  offs.push(
    transport.on('session.resume.failed', (ev) => {
      const p = ev.payload as
        | { vac_session_id?: string; reason?: string; detail?: string }
        | null;
      if (!p?.vac_session_id) return;
      // exactOptionalPropertyTypes: omit `detail` rather than passing
      // an explicit `undefined`.
      useSessionHistory.getState().setResume({
        kind: 'failed',
        vac_session_id: p.vac_session_id,
        reason: p.reason ?? 'unknown',
        ...(typeof p.detail === 'string' ? { detail: p.detail } : {}),
      });
    }),
  );

  // Stage R3 — surface the bridge's normalized resume policy so the
  // FE preview block always reflects what the runtime will actually
  // enforce. The bridge sends `config.validated` in response to a
  // `config.policy.get` query and (in R4) on reload broadcasts.
  offs.push(
    transport.on('config.validated', (ev) => {
      const p = ev.payload as
        | {
            scope?: string;
            ok?: boolean;
            policy?: Partial<ResumePolicySnapshot>;
          }
        | null;
      if (!p?.policy) return;
      const pol = p.policy;
      // Defensive narrowing: drop the snapshot entirely rather than
      // half-render an unknown enum value. If the bridge ever ships a
      // 4th mode we want the FE to fall back to "unknown" instead of
      // claiming we know what's enforced.
      if (
        !pol.default_mode ||
        !pol.native_fallback ||
        !pol.mcp_server_drift ||
        !pol.profile_class_mismatch ||
        typeof pol.retention_days !== 'number' ||
        typeof pol.max_events !== 'number'
      ) {
        return;
      }
      useSessionHistory.getState().setResumePolicy(pol as ResumePolicySnapshot);
    }),
  );

  // Stage R3 — latch validation failures so the preview block can
  // render an inline "Config invalid" chip plus the offending
  // path/message. Bridge falls back to defaults when validation
  // fails, so the runtime keeps working but the FE flags it.
  offs.push(
    transport.on('config.validate.failed', (ev) => {
      const p = ev.payload as
        | { scope?: string; errors?: Array<Partial<ConfigDiagnostic>> }
        | null;
      if (!p?.errors) return;
      const diags: ConfigDiagnostic[] = p.errors
        .filter((e): e is ConfigDiagnostic =>
          typeof e?.scope === 'string' &&
          typeof e?.path === 'string' &&
          typeof e?.message === 'string',
        )
        .map((e) => ({
          scope: e.scope,
          path: e.path,
          message: e.message,
          ...(e.severity ? { severity: e.severity } : {}),
          ...(e.code ? { code: e.code } : {}),
        }));
      if (diags.length) useSessionHistory.getState().setConfigDiagnostics(diags);
    }),
  );

  offs.push(
    transport.on('session.resume.warning', (ev) => {
      const p = ev.payload as
        | { vac_session_id?: string; reason?: string; detail?: string; at?: string }
        | null;
      if (!p?.vac_session_id) return;
      useSessionHistory.getState().recordResumeWarning({
        vac_session_id: p.vac_session_id,
        reason: p.reason ?? 'unknown',
        ...(typeof p.detail === 'string' ? { detail: p.detail } : {}),
        at: typeof p.at === 'string' ? p.at : new Date().toISOString(),
      });
    }),
  );

  return () => {
    for (const off of offs) off();
  };
}

export async function requestHistoryList(
  transport: TransportHandle,
  opts: { project_root?: string; agent_id?: string; limit?: number } = {},
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (opts.project_root) payload.project_root = opts.project_root;
  if (opts.agent_id) payload.agent_id = opts.agent_id;
  if (typeof opts.limit === 'number') payload.limit = opts.limit;
  await transport.send('', 'session.history.list', payload).catch(() => {
    /* listed event resolves */
  });
}

export async function requestHistoryResume(
  transport: TransportHandle,
  vac_session_id: string,
  mode: ResumeMode = 'replay_only',
): Promise<void> {
  useSessionHistory.getState().setResume({
    kind: 'starting',
    vac_session_id,
    mode,
  });
  await transport
    .send(vac_session_id, 'session.resume', { vac_session_id, mode })
    .catch((err: unknown) => {
      useSessionHistory.getState().setResume({
        kind: 'failed',
        vac_session_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Stage R3 — ask the bridge for the current normalized resume
 * policy. Resolves when the ack lands; the actual snapshot arrives
 * asynchronously on the `config.validated` ServerEvent and lands in
 * `useSessionHistory.resumePolicy`.
 */
export async function requestResumePolicy(transport: TransportHandle): Promise<void> {
  await transport.send('', 'config.policy.get', {}).catch(() => {
    /* config.validated event resolves */
  });
}

export async function requestHistoryForget(
  transport: TransportHandle,
  vac_session_id: string,
): Promise<void> {
  await transport
    .send('', 'session.history.forget', { vac_session_id })
    .catch(() => {
      /* forgotten event resolves */
    });
}
