// Stage X6 4-5 — reducer tests for the extended ResumeStatus state
// machine driven by `session.resume.*` and `vac.session_resumed_native`
// ServerEvents. The transitions exercised here mirror the seven
// integration cases in batch 4-6, expressed as pure store updates
// against a mock transport so we don't need a live bridge.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerSessionHistoryHandlers } from './history';
import { useSessionHistory } from '../../stores/sessionHistory';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, remaining);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = {
      seq: 1,
      session_id: 's',
      type,
      payload,
      v: 1,
      ts: '2026-04-30T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('session history resume state machine (Stage X6 4-5)', () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    useSessionHistory.getState().clear();
  });

  afterEach(() => {
    if (detach) {
      detach();
      detach = null;
    }
  });

  it('starts in idle', () => {
    expect(useSessionHistory.getState().resume).toEqual({ kind: 'idle' });
  });

  it('native_resume_success: starting → loading_native → replaying → resumed(native)', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-1', mode: 'acp_load' });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'starting',
      vac_session_id: 'vac-1',
      mode: 'acp_load',
    });

    emit('vac.session_resumed_native', { vac_session_id: 'vac-1' });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'loading_native',
      vac_session_id: 'vac-1',
    });

    emit('session.replay.progress', {
      vac_session_id: 'vac-1',
      replayed: 3,
      mode: 'acp_load',
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'replaying',
      vac_session_id: 'vac-1',
      replayed: 3,
    });

    emit('session.resumed', {
      vac_session_id: 'vac-1',
      mode: 'acp_load',
      resume_mode: 'native',
      native: true,
      replayed_events: 3,
    });
    const final = useSessionHistory.getState().resume;
    expect(final).toMatchObject({
      kind: 'resumed',
      vac_session_id: 'vac-1',
      mode: 'native',
      native: true,
      replayed: 3,
    });
  });

  it('replay_only_fallback: native request that the bridge silently fell back to replay', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-2', mode: 'native_or_replay' });
    emit('session.replay.progress', {
      vac_session_id: 'vac-2',
      replayed: 7,
      mode: 'native_or_replay',
    });
    emit('session.resumed', {
      vac_session_id: 'vac-2',
      mode: 'native_or_replay',
      resume_mode: 'replay_only_fallback',
      native: false,
      replayed_events: 7,
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'resumed',
      mode: 'replay_only_fallback',
      native: false,
      replayed: 7,
    });
  });

  it('explicit replay_only success ends with mode=replay_only', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-3', mode: 'replay_only' });
    emit('session.history.replay.tick', {
      vac_session_id: 'vac-3',
      replayed: 12,
      mode: 'replay_only',
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'replaying',
      replayed: 12,
    });
    emit('session.resumed', {
      vac_session_id: 'vac-3',
      mode: 'replay_only',
      resume_mode: 'replay_only',
      native: false,
      replayed_events: 12,
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'resumed',
      mode: 'replay_only',
      native: false,
      replayed: 12,
    });
  });

  it('native_resume_unsupported: failed reason surfaces with detail', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-4', mode: 'acp_load' });
    emit('session.resume.failed', {
      vac_session_id: 'vac-4',
      reason: 'native_resume_unsupported',
      detail: 'agent does not implement session/load',
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'failed',
      vac_session_id: 'vac-4',
      reason: 'native_resume_unsupported',
      detail: 'agent does not implement session/load',
    });
  });

  it('session.resume.warning records non-terminal MCP drift warning', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-warn', mode: 'acp_load' });
    emit('session.resume.warning', {
      vac_session_id: 'vac-warn',
      reason: 'mcp_server_drift',
      detail: 'MCP server set changed since this session was created',
      at: '2026-04-30T00:00:00.000Z',
    });

    const state = useSessionHistory.getState();
    expect(state.resume).toMatchObject({
      kind: 'starting',
      vac_session_id: 'vac-warn',
    });
    expect(state.lastWarning).toEqual({
      vac_session_id: 'vac-warn',
      reason: 'mcp_server_drift',
      detail: 'MCP server set changed since this session was created',
      at: '2026-04-30T00:00:00.000Z',
    });
    expect(state.resumeWarnings['vac-warn']).toEqual(state.lastWarning);
  });

  // Stage R2 — legacy persisted meta missing `profile_class` is a
  // non-blocking warning emitted before the resume lifecycle
  // events. Verify the same store machinery used for
  // `mcp_server_drift` keys this reason on `vac_session_id` and
  // exposes it as `lastWarning` + `resumeWarnings[id]`.
  it('session.resume.warning records profile_class_missing for legacy meta', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-r2', mode: 'native_or_replay' });
    emit('session.resume.warning', {
      vac_session_id: 'vac-r2',
      reason: 'profile_class_missing',
      at: '2026-04-30T00:00:00.000Z',
    });

    const state = useSessionHistory.getState();
    expect(state.lastWarning).toMatchObject({
      vac_session_id: 'vac-r2',
      reason: 'profile_class_missing',
    });
    expect(state.resumeWarnings['vac-r2']).toMatchObject({
      reason: 'profile_class_missing',
    });
  });

  for (const reason of [
    'vac_session_unknown',
    'agent_not_in_registry',
    'agent_kind_mismatch',
    'profile_not_found',
    'project_root_unavailable',
    'native_resume_rejected',
    'native_resume_failed',
  ]) {
    it(`failure reason "${reason}" lands in failed state`, () => {
      const { t, emit } = mockTransport();
      detach = registerSessionHistoryHandlers(t);
      emit('session.resume.started', { vac_session_id: 'vac-x', mode: 'acp_load' });
      emit('session.resume.failed', { vac_session_id: 'vac-x', reason });
      expect(useSessionHistory.getState().resume).toMatchObject({
        kind: 'failed',
        reason,
      });
    });
  }

  it('replay.progress for an unrelated session is ignored', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('session.resume.started', { vac_session_id: 'vac-A', mode: 'replay_only' });
    emit('session.replay.progress', {
      vac_session_id: 'vac-OTHER',
      replayed: 99,
      mode: 'replay_only',
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'starting',
      vac_session_id: 'vac-A',
    });
  });

  it('replay.progress without a vac_session_id is dropped', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);
    emit('session.resume.started', { vac_session_id: 'vac-B', mode: 'replay_only' });
    emit('session.replay.progress', { replayed: 5 });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'starting',
      vac_session_id: 'vac-B',
    });
  });

  it('replay.progress after a terminal resumed state does not regress', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);
    emit('session.resume.started', { vac_session_id: 'vac-C', mode: 'replay_only' });
    emit('session.resumed', {
      vac_session_id: 'vac-C',
      mode: 'replay_only',
      native: false,
      replayed_events: 4,
    });
    emit('session.replay.progress', { vac_session_id: 'vac-C', replayed: 2 });
    expect(useSessionHistory.getState().resume.kind).toBe('resumed');
  });

  // Stage R4 — config snapshot lifecycle. The bridge sends
  // `config.validated` (and `config.reloaded`) with a wide payload
  // including the resume policy, agent registry, and MCP servers.
  // The store must merge these into the preview surfaces and flip
  // `configStatus` to `valid`.
  it('config.validated wide payload populates preview surfaces and flips status to valid', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('config.validated', {
      scope: 'config',
      ok: true,
      loaded_at: '2026-04-30T09:30:00Z',
      vac_version: 1,
      policy: {
        default_mode: 'native_or_replay',
        native_fallback: 'replay_only',
        mcp_server_drift: 'warn',
        profile_class_mismatch: 'fail',
        retention_days: 30,
        max_events: 5000,
      },
      agents: {
        version: 1,
        count: 2,
        default_id: 'mock-1',
        items: [
          { id: 'mock-1', kind: 'mock', enabled: true },
          { id: 'acp-1', kind: 'acp', enabled: false },
        ],
      },
      mcp: {
        version: 1,
        count: 1,
        servers: [{ id: 'fs', transport: 'stdio', enabled: true }],
      },
      diagnostics: [],
    });

    const s = useSessionHistory.getState();
    expect(s.configStatus).toBe('valid');
    expect(s.configLoadedAt).toBe('2026-04-30T09:30:00Z');
    expect(s.vacVersion).toBe(1);
    expect(s.resumePolicy).toMatchObject({ default_mode: 'native_or_replay' });
    expect(s.agentsSummary).toMatchObject({ count: 2, default_id: 'mock-1' });
    expect(s.mcpSummary).toMatchObject({ count: 1 });
    expect(s.configDiagnostics).toEqual([]);
    expect(s.configReloading).toBe(false);
  });

  it('config.reload.started flips configReloading to true without dropping the existing snapshot', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    // seed with a known-good snapshot first
    emit('config.validated', {
      ok: true,
      policy: {
        default_mode: 'replay_only',
        native_fallback: 'replay_only',
        mcp_server_drift: 'ignore',
        profile_class_mismatch: 'warn',
        retention_days: 7,
        max_events: 100,
      },
      agents: { version: 1, count: 1, default_id: null, items: [] },
      mcp: { version: 1, count: 0, servers: [] },
    });
    expect(useSessionHistory.getState().resumePolicy?.default_mode).toBe('replay_only');

    emit('config.reload.started', {});
    const s = useSessionHistory.getState();
    expect(s.configReloading).toBe(true);
    // existing snapshot is retained
    expect(s.resumePolicy?.default_mode).toBe('replay_only');
  });

  it('config.reloaded swaps the snapshot atomically and clears configReloading', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    emit('config.reload.started', {});
    expect(useSessionHistory.getState().configReloading).toBe(true);

    emit('config.reloaded', {
      ok: true,
      loaded_at: '2026-04-30T10:00:00Z',
      vac_version: 2,
      policy: {
        default_mode: 'acp_load',
        native_fallback: 'fail',
        mcp_server_drift: 'fail',
        profile_class_mismatch: 'fail',
        retention_days: 60,
        max_events: 10000,
      },
      agents: { version: 2, count: 3, default_id: 'mock-1', items: [] },
      mcp: { version: 2, count: 2, servers: [] },
      diagnostics: [],
    });

    const s = useSessionHistory.getState();
    expect(s.configStatus).toBe('valid');
    expect(s.configReloading).toBe(false);
    expect(s.vacVersion).toBe(2);
    expect(s.resumePolicy?.default_mode).toBe('acp_load');
    expect(s.agentsSummary?.count).toBe(3);
    expect(s.mcpSummary?.count).toBe(2);
  });

  it('config.reload_failed keeps previous snapshot and surfaces diagnostics', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    // seed a healthy snapshot
    emit('config.validated', {
      ok: true,
      policy: {
        default_mode: 'replay_only',
        native_fallback: 'replay_only',
        mcp_server_drift: 'warn',
        profile_class_mismatch: 'warn',
        retention_days: 14,
        max_events: 500,
      },
      agents: { version: 1, count: 4, default_id: 'a', items: [] },
      mcp: { version: 1, count: 1, servers: [] },
    });

    emit('config.reload.started', {});
    emit('config.reload_failed', {
      diagnostics: [
        {
          scope: 'agents',
          path: 'agents.registry[0].id',
          message: 'duplicate agent id',
          severity: 'error',
          code: 'agents.duplicate_id',
        },
      ],
    });

    const s = useSessionHistory.getState();
    expect(s.configStatus).toBe('invalid');
    expect(s.configReloading).toBe(false);
    // policy/agents/mcp should NOT be cleared — the bridge keeps the
    // previous snapshot live, and the FE should mirror that.
    expect(s.resumePolicy?.default_mode).toBe('replay_only');
    expect(s.agentsSummary?.count).toBe(4);
    expect(s.configDiagnostics).toHaveLength(1);
    expect(s.configDiagnostics[0]).toMatchObject({
      scope: 'agents',
      path: 'agents.registry[0].id',
      severity: 'error',
      code: 'agents.duplicate_id',
    });
  });

  it('config.validate.failed (R3 legacy errors[] and R4 diagnostics[]) both flip status to invalid', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);

    // R3 legacy shape
    emit('config.validate.failed', {
      scope: 'session_resume',
      errors: [
        { scope: 'session_resume', path: 'retention_days', message: 'must be > 0' },
      ],
    });
    let s = useSessionHistory.getState();
    expect(s.configStatus).toBe('invalid');
    expect(s.configDiagnostics).toHaveLength(1);

    useSessionHistory.getState().clear();

    // R4 wide shape
    emit('config.validate.failed', {
      scope: 'config',
      diagnostics: [
        { scope: 'mcp', path: 'mcp.servers[0].id', message: 'missing id' },
      ],
    });
    s = useSessionHistory.getState();
    expect(s.configStatus).toBe('invalid');
    expect(s.configDiagnostics).toHaveLength(1);
    expect(s.configDiagnostics[0].scope).toBe('mcp');
  });

  it('asEffectiveMode coerces older bridge native flag', () => {
    const { t, emit } = mockTransport();
    detach = registerSessionHistoryHandlers(t);
    emit('session.resume.started', { vac_session_id: 'vac-D', mode: 'acp_load' });
    // Bridge omits resume_mode, only sends `mode` + `native`.
    emit('session.resumed', {
      vac_session_id: 'vac-D',
      mode: 'acp_load',
      native: true,
      replayed_events: 0,
    });
    expect(useSessionHistory.getState().resume).toMatchObject({
      kind: 'resumed',
      mode: 'native',
      native: true,
    });
  });
});
