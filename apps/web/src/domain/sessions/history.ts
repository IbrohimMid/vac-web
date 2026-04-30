// Wire `session.history.*` and replay-only `session.resume*` ServerEvents
// into the persistent-session-history store. Phase 3 of
// durable-session-history.

import {
  useSessionHistory,
  type AgentRegistrySummary,
  type ConfigDiagnostic,
  type EffectiveResumeMode,
  type McpServersSummary,
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

  // Stage R3/R4 — surface the bridge's normalized resume policy so the
  // FE preview block always reflects what the runtime will actually
  // enforce. The bridge sends `config.validated` in response to a
  // `config.policy.get` (R3 narrow shape: just `policy`) **and** to
  // `config.validate` (R4 wide shape: full snapshot with agents,
  // mcp, vac_version, diagnostics). `config.reloaded` carries the
  // same wide shape after a successful `config.reload`.
  const onConfigSnapshot = (ev: { payload: unknown }) => {
    const p = ev.payload as
      | {
          ok?: boolean;
          loaded_at?: string;
          vac_version?: number;
          policy?: Partial<ResumePolicySnapshot>;
          agents?: Partial<AgentRegistrySummary>;
          mcp?: Partial<McpServersSummary>;
          diagnostics?: Array<Partial<ConfigDiagnostic>>;
        }
      | null;
    if (!p) return;
    const pol = p.policy;
    // Defensive narrowing: only accept a fully-typed policy. If the
    // bridge ever ships a 4th mode we want the FE to fall back to
    // the previous snapshot rather than half-render an unknown enum.
    const policy: ResumePolicySnapshot | null =
      pol &&
      pol.default_mode &&
      pol.native_fallback &&
      pol.mcp_server_drift &&
      pol.profile_class_mismatch &&
      typeof pol.retention_days === 'number' &&
      typeof pol.max_events === 'number'
        ? (pol as ResumePolicySnapshot)
        : null;
    const agents: AgentRegistrySummary | null =
      p.agents && typeof p.agents.count === 'number'
        ? {
            version: p.agents.version ?? 0,
            count: p.agents.count,
            default_id: p.agents.default_id ?? null,
            items: Array.isArray(p.agents.items) ? p.agents.items : [],
          }
        : null;
    const mcp: McpServersSummary | null =
      p.mcp && typeof p.mcp.count === 'number'
        ? {
            version: p.mcp.version ?? 0,
            count: p.mcp.count,
            servers: Array.isArray(p.mcp.servers) ? p.mcp.servers : [],
          }
        : null;
    const diagnostics: ConfigDiagnostic[] = (p.diagnostics ?? [])
      .filter(
        (e): e is ConfigDiagnostic =>
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
    useSessionHistory.getState().applyConfigSnapshot({
      ok: p.ok ?? true,
      ...(typeof p.loaded_at === 'string' ? { loaded_at: p.loaded_at } : {}),
      ...(typeof p.vac_version === 'number' ? { vac_version: p.vac_version } : {}),
      policy,
      agents,
      mcp,
      diagnostics,
    });
  };
  offs.push(transport.on('config.validated', onConfigSnapshot));
  offs.push(transport.on('config.reloaded', onConfigSnapshot));

  // Stage R4 — reload lifecycle events. `started` flips a spinner;
  // `reload_failed` keeps the previous snapshot installed (matching
  // bridge behavior) and surfaces the diagnostics so the operator
  // can fix the YAML before retrying.
  offs.push(
    transport.on('config.reload.started', () => {
      useSessionHistory.getState().beginConfigReload();
    }),
  );
  offs.push(
    transport.on('config.reload_failed', (ev) => {
      const p = ev.payload as
        | { diagnostics?: Array<Partial<ConfigDiagnostic>> }
        | null;
      const diags: ConfigDiagnostic[] = (p?.diagnostics ?? [])
        .filter(
          (e): e is ConfigDiagnostic =>
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
      useSessionHistory.getState().recordConfigReloadFailure(diags);
    }),
  );

  // Stage R3 — legacy `config.validate.failed` carrying just an
  // `errors` array. Newer bridges fold this into the wide
  // `config.validate.failed` payload via `diagnostics`, but we keep
  // the old key so older snapshots still flag the topbar chip.
  offs.push(
    transport.on('config.validate.failed', (ev) => {
      const p = ev.payload as
        | {
            scope?: string;
            errors?: Array<Partial<ConfigDiagnostic>>;
            diagnostics?: Array<Partial<ConfigDiagnostic>>;
          }
        | null;
      const raw = p?.diagnostics ?? p?.errors ?? [];
      const diags: ConfigDiagnostic[] = raw
        .filter(
          (e): e is ConfigDiagnostic =>
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

/**
 * Stage R4 — ask the bridge to echo its live config snapshot
 * (agents, MCP, resume policy, diagnostics). Useful for the
 * preview panel's "Validate" button. The actual snapshot arrives
 * via `config.validated`.
 */
export async function requestConfigValidate(transport: TransportHandle): Promise<void> {
  await transport.send('', 'config.validate', {}).catch(() => {
    /* config.validated / config.validate.failed event resolves */
  });
}

/**
 * Stage R4 — trigger a `config.reload` on the bridge. Re-reads
 * every YAML file under `config/` and, on success, swaps the
 * snapshot atomically. The `config.reload.started` event flips the
 * spinner; the terminal `config.reloaded` / `config.reload_failed`
 * event resolves it.
 */
export async function requestConfigReload(transport: TransportHandle): Promise<void> {
  useSessionHistory.getState().beginConfigReload();
  await transport.send('', 'config.reload', {}).catch(() => {
    /* terminal event resolves the spinner */
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
