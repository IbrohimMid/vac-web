import { beforeEach, describe, expect, it } from 'vitest';
import { registerRuntimeHandlers } from './handlers';
import { useRuntime } from '../../stores/runtime';
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
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('runtime handlers', () => {
  beforeEach(() =>
    useRuntime.setState({
      jobs: new Map(),
      order: [],
      logs: new Map(),
    }),
  );

  it('maps runtime.job_log into runtime jobs and logs', () => {
    const { t, emit } = mockTransport();
    const off = registerRuntimeHandlers(t);

    emit('runtime.job_log', {
      tool_call_id: 'tc1',
      status: 'completed',
      command: 'cargo test --workspace',
      output: 'ok',
      approved_by_approval_id: 'appr_01',
    });

    const job = useRuntime.getState().jobs.get('tc1');
    expect(job?.kind).toBe('execute');
    expect(job?.label).toBe('cargo test --workspace');
    expect(job?.status).toBe('succeeded');
    expect(job?.toolCallId).toBe('tc1');
    expect(job?.approvedByApprovalId).toBe('appr_01');
    expect(job?.sourceEventType).toBe('runtime.job_log');
    expect(useRuntime.getState().logs.get('tc1')?.[0]?.text).toBe('ok');

    off();
  });
});
