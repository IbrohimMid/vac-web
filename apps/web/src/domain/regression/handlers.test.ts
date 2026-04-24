// Integration: handler wired to mock transport + asserts sticky banner fires
// on verdict drop.

import { beforeEach, describe, expect, it } from 'vitest';
import { registerRegressionHandlers } from './handlers';
import { useAssessment, type Run } from '../../stores/assessment';
import { useNotify } from '../../stores/notify';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, h) {
      const list = handlers.get(type) ?? [];
      list.push(h);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((x) => x !== h) ?? [];
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
      ts: 't',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

const mkRun = (id: string, verdict: 'pass' | 'warn' | 'fail'): Run => ({
  id,
  swarm: 'rtd',
  status: 'completed',
  started_at: 't',
  progress: { completed: 5, total: 5 },
  verdict,
});

describe('regression handlers', () => {
  beforeEach(() => {
    useAssessment.getState().clear();
    useNotify.setState({
      transient: [],
      persistent: [],
      sticky: new Map(),
    });
  });

  it('verdict drop fires a sticky banner at severity warn', () => {
    const { t, emit } = mockTransport();
    const off = registerRegressionHandlers(t);
    // First run (prior) — pass.
    useAssessment.getState().upsertRun(mkRun('r1', 'pass'));
    useAssessment.getState().completeRun('r1', 'pass', {
      technical: 0.9,
      product: 0.9,
      ux: 0.9,
      release: 0.9,
      ops: 0.9,
    });
    // Second run (next) — warn.
    useAssessment.getState().upsertRun(mkRun('r2', 'warn'));
    useAssessment.getState().completeRun('r2', 'warn', {
      technical: 0.9,
      product: 0.9,
      ux: 0.9,
      release: 0.9,
      ops: 0.9,
    });

    emit('assessment.completed', { run_id: 'r2' });

    const sticky = Array.from(useNotify.getState().sticky.values());
    expect(sticky.some((s) => s.subsystem === 'regression')).toBe(true);
    off();
  });

  it('no prior run = no regression signal', () => {
    const { t, emit } = mockTransport();
    const off = registerRegressionHandlers(t);
    useAssessment.getState().upsertRun(mkRun('r1', 'pass'));
    useAssessment.getState().completeRun('r1', 'pass', {
      technical: 0.9,
      product: 0.9,
      ux: 0.9,
      release: 0.9,
      ops: 0.9,
    });
    emit('assessment.completed', { run_id: 'r1' });
    expect(useNotify.getState().sticky.size).toBe(0);
    off();
  });
});
