import { beforeEach, describe, expect, it } from 'vitest';
import { useApprovals } from './approvals';

function reset() {
  useApprovals.setState({
    pending: new Map(),
    pendingOrder: [],
    resolved: new Map(),
    resolvedOrder: [],
  });
}

describe('approvals store', () => {
  beforeEach(reset);

  const base = {
    approvalId: 'appr_01',
    toolCallId: 'tc1',
    tool: 'edit_file',
    risk: 'medium' as const,
    summary: 's',
    args: {},
    createdAt: 't',
    state: 'pending' as const,
    sourceEventType: 'approval.pending',
    toolCall: {},
    expiresInMs: null,
    options: [],
  };

  it('upsertPending adds to order', () => {
    useApprovals.getState().upsertPending(base);
    expect(useApprovals.getState().pendingOrder).toEqual(['appr_01']);
  });

  it('resolve removes from pending, records resolved', () => {
    useApprovals.getState().upsertPending(base);
    useApprovals.getState().resolve({
      approvalId: 'appr_01',
      decision: 'approved',
      outcome: 'approved',
      resolvedAt: 't2',
      sourceEventType: 'approval.resolved',
    });
    const s = useApprovals.getState();
    expect(s.pendingOrder).toEqual([]);
    expect(s.resolved.get('appr_01')?.decision).toBe('approved');
    expect(s.resolved.get('appr_01')?.toolCallId).toBe('tc1');
  });

  it('markDeciding transitions state', () => {
    useApprovals.getState().upsertPending(base);
    useApprovals.getState().markDeciding('appr_01');
    expect(useApprovals.getState().pending.get('appr_01')?.state).toBe('deciding');
  });

  it('markDeciding is a no-op for unknown id', () => {
    useApprovals.getState().markDeciding('nope');
    expect(useApprovals.getState().pending.size).toBe(0);
  });
});
