import { beforeEach, describe, expect, it } from 'vitest';
import { registerApprovalHandlers } from './handlers';
import { useApprovals } from '../../stores/approvals';
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

describe('approval handlers', () => {
  beforeEach(() =>
    useApprovals.setState({
      pending: new Map(),
      pendingOrder: [],
      resolved: new Map(),
      resolvedOrder: [],
    }),
  );

  it('maps approval.pending and approval.resolved into visible approvals state', () => {
    const { t, emit } = mockTransport();
    const off = registerApprovalHandlers(t);

    emit('approval.pending', {
      approval_id: 'appr_01',
      tool_call: {
        toolCallId: 'tc1',
        kind: 'edit',
        title: 'Write hello.md',
        rawInput: { file_path: '/repo/hello.md' },
      },
      options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
      expires_in_ms: 60000,
    });

    const pending = useApprovals.getState().pending.get('appr_01');
    expect(pending?.toolCallId).toBe('tc1');
    expect(pending?.sourceEventType).toBe('approval.pending');
    expect(pending?.options.map((opt) => opt.optionId)).toEqual(['allow', 'reject']);
    expect(pending?.summary).toBe('Write hello.md');

    emit('approval.resolved', {
      approval_id: 'appr_01',
      outcome: 'approved',
      option_id: 'allow',
    });

    const resolved = useApprovals.getState().resolved.get('appr_01');
    expect(useApprovals.getState().pending.size).toBe(0);
    expect(resolved?.decision).toBe('approved');
    expect(resolved?.optionId).toBe('allow');
    expect(resolved?.sourceEventType).toBe('approval.resolved');

    off();
  });
});
