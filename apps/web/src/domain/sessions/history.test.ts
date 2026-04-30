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
