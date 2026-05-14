import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerValidationHandlers, requestValidationFailureContext, requestValidationRun } from './handlers';
import { useValidation } from '../../stores/validation';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    send: vi.fn().mockResolvedValue({} as never),
    on(type: string, handler: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
    },
    close() {},
  } as unknown as TransportHandle;
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = { seq: 1, session_id: 's1', type, payload, v: 1, ts: '2026-05-14T00:00:00Z' };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('validation handlers', () => {
  beforeEach(() => useValidation.getState().resetAll());

  it('maps validation.run.updated into validation store', () => {
    const { t, emit } = mockTransport();
    const off = registerValidationHandlers(t);
    emit('validation.run.updated', {
      run_id: 'run1',
      command: 'pnpm -F web typecheck',
      label: 'Typecheck',
      status: 'failed',
      finished_at: '2026-05-14T00:01:00Z',
      duration_ms: 1000,
      error_message: 'TS error',
      related_files: ['src/a.ts'],
      task_id: 'task1',
    });
    expect(useValidation.getState().runs.get('run1')).toMatchObject({ status: 'failed', message: 'TS error', relatedFiles: ['src/a.ts'], taskId: 'task1' });
    off();
  });

  it('ignores malformed payload with safe defaults', () => {
    const { t, emit } = mockTransport();
    registerValidationHandlers(t);
    emit('validation.run.updated', null);
    expect(useValidation.getState().order).toHaveLength(1);
    expect(useValidation.getState().runs.get(useValidation.getState().order[0]!)).toMatchObject({ command: 'validation command', status: 'idle' });
  });

  it('cleans up listeners', () => {
    const { t, emit } = mockTransport();
    const off = registerValidationHandlers(t);
    off();
    emit('validation.run.updated', { run_id: 'run1' });
    expect(useValidation.getState().order).toEqual([]);
  });

  it('sends validation run request', async () => {
    const { t } = mockTransport();
    await requestValidationRun(t, 's1', { command: 'pnpm test', taskId: 'task1', relatedFiles: ['a.ts'] });
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.run.request', { session_id: 's1', command: 'pnpm test', task_id: 'task1', related_files: ['a.ts'] });
  });

  it('sends validation failure context request', async () => {
    const { t } = mockTransport();
    await requestValidationFailureContext(t, 's1', 'run1');
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.failure.send_context', { session_id: 's1', run_id: 'run1' });
  });
});
