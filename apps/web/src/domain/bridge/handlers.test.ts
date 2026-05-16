import { beforeEach, describe, expect, it } from 'vitest';
import { registerBridgeHandlers } from './handlers';
import { useMutations } from '../../stores/mutations';
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
  const emit = (type: string, payload: unknown, sessionId = 's') => {
    const frame: EventFrame = {
      seq: 1,
      session_id: sessionId,
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('bridge handlers', () => {
  beforeEach(() => useMutations.setState({ intents: {}, order: [] }));

  it('maps bridge.mutation.requested into a pending intent with audit fields', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', {
      request_id: 'req-1',
      kind: 'write',
      summary: 'Create src/foo.ts',
      rationale: 'Adds new feature',
      target_path: 'src/foo.ts',
      diff_preview: '+ hello',
      originating_task_id: 'task-1',
    });

    const intent = useMutations.getState().intents['req-1'];
    expect(intent?.kind).toBe('write');
    expect(intent?.summary).toBe('Create src/foo.ts');
    expect(intent?.rationale).toBe('Adds new feature');
    expect(intent?.targetPath).toBe('src/foo.ts');
    expect(intent?.diffPreview).toBe('+ hello');
    expect(intent?.originatingTaskId).toBe('task-1');
    expect(intent?.originatingSessionId).toBe('s');
    expect(intent?.status).toBe('pending');
    expect(intent?.sourceEventType).toBe('bridge.mutation.requested');

    off();
  });

  it('drops payloads missing request_id (defensive against malformed mock)', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', { kind: 'write', summary: 'No id' });
    expect(Object.keys(useMutations.getState().intents)).toHaveLength(0);

    off();
  });

  it('coerces unknown kinds to "unknown" instead of trusting raw input', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', {
      request_id: 'req-2',
      kind: 'launch_missiles',
      summary: 'Suspicious',
    });

    expect(useMutations.getState().intents['req-2']?.kind).toBe('unknown');

    off();
  });

  it('falls back to a default summary when payload omits one', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', { request_id: 'req-3' });

    const intent = useMutations.getState().intents['req-3'];
    expect(intent?.summary).toBe('(no summary)');
    expect(intent?.kind).toBe('unknown');

    off();
  });

  it('upserts on repeat requestId without duplicating order', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', { request_id: 'req-4', summary: 'v1' });
    emit('bridge.mutation.requested', { request_id: 'req-4', summary: 'v2' });

    expect(useMutations.getState().order).toEqual(['req-4']);
    expect(useMutations.getState().intents['req-4']?.summary).toBe('v2');

    off();
  });

  it('falls back to frame session_id when payload omits originating_session_id', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit(
      'bridge.mutation.requested',
      { request_id: 'req-5', summary: 'x' },
      'sess-42',
    );

    expect(useMutations.getState().intents['req-5']?.originatingSessionId).toBe('sess-42');

    off();
  });

  it('bridge.mutation.applied stamps the intent as applied with a path/time message', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);
    useMutations.getState().upsert({
      requestId: 'req-applied', kind: 'write', summary: 'x', receivedAt: 1,
      status: 'approved', sourceEventType: 'bridge.mutation.requested',
    });
    emit('bridge.mutation.applied', {
      request_id: 'req-applied', applied_path: 'src/foo.ts', applied_at: '2026-05-15T17:00:00Z',
    });
    const cur = useMutations.getState().intents['req-applied'];
    expect(cur?.status).toBe('applied');
    expect(cur?.statusMessage).toContain('src/foo.ts');
    off();
  });

  it('bridge.mutation.failed stamps failed with a reason and optional error_code', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);
    useMutations.getState().upsert({
      requestId: 'req-fail', kind: 'write', summary: 'x', receivedAt: 1,
      status: 'approved', sourceEventType: 'bridge.mutation.requested',
    });
    emit('bridge.mutation.failed', { request_id: 'req-fail', reason: 'EACCES', error_code: 'fs.permission_denied' });
    const cur = useMutations.getState().intents['req-fail'];
    expect(cur?.status).toBe('failed');
    expect(cur?.statusMessage).toMatch(/fs.permission_denied/);
    expect(cur?.statusMessage).toMatch(/EACCES/);
    off();
  });

  it('bridge.mutation.updated transitions to applying with a message', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);
    useMutations.getState().upsert({
      requestId: 'req-up', kind: 'write', summary: 'x', receivedAt: 1,
      status: 'approved', sourceEventType: 'bridge.mutation.requested',
    });
    emit('bridge.mutation.updated', { request_id: 'req-up', status: 'applying', message: 'Writing 3 hunks' });
    const cur = useMutations.getState().intents['req-up'];
    expect(cur?.status).toBe('applying');
    expect(cur?.statusMessage).toBe('Writing 3 hunks');
    off();
  });

  it('bridge.mutation.updated rejects unknown status values', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);
    useMutations.getState().upsert({
      requestId: 'req-bad', kind: 'write', summary: 'x', receivedAt: 1,
      status: 'approved', sourceEventType: 'bridge.mutation.requested',
    });
    emit('bridge.mutation.updated', { request_id: 'req-bad', status: 'launch_missiles' });
    expect(useMutations.getState().intents['req-bad']?.status).toBe('approved');
    off();
  });

  it('lifecycle events are dropped when requestId is unknown to the store', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);
    emit('bridge.mutation.applied', { request_id: 'never-seen' });
    emit('bridge.mutation.failed', { request_id: 'never-seen', reason: 'x' });
    expect(useMutations.getState().intents['never-seen']).toBeUndefined();
    off();
  });

  it('accepts camelCase aliases for snake_case payload fields', () => {
    const { t, emit } = mockTransport();
    const off = registerBridgeHandlers(t);

    emit('bridge.mutation.requested', {
      requestId: 'req-6',
      kind: 'edit',
      summary: 'Update src/bar.ts',
      targetPath: 'src/bar.ts',
      diffPreview: '- old\n+ new',
      originatingTaskId: 'task-9',
      originatingSessionId: 'sess-99',
    });

    const intent = useMutations.getState().intents['req-6'];
    expect(intent?.kind).toBe('edit');
    expect(intent?.targetPath).toBe('src/bar.ts');
    expect(intent?.diffPreview).toBe('- old\n+ new');
    expect(intent?.originatingTaskId).toBe('task-9');
    expect(intent?.originatingSessionId).toBe('sess-99');

    off();
  });
});
