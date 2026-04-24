import { beforeEach, describe, expect, it } from 'vitest';
import { useApprovals } from './approvals';

function reset() {
  useApprovals.setState({ pending: new Map(), order: [], decided: new Map() });
}

describe('approvals store', () => {
  beforeEach(reset);

  const base = {
    id: 'tc1',
    tool: 'edit_file',
    risk: 'medium' as const,
    summary: 's',
    args: {},
    createdAt: 't',
    state: 'pending' as const,
  };

  it('upsertPending adds to order', () => {
    useApprovals.getState().upsertPending(base);
    expect(useApprovals.getState().order).toEqual(['tc1']);
  });

  it('resolve removes from pending, records decided', () => {
    useApprovals.getState().upsertPending(base);
    useApprovals.getState().resolve('tc1', 'approved');
    const s = useApprovals.getState();
    expect(s.order).toEqual([]);
    expect(s.decided.get('tc1')).toBe('approved');
  });

  it('markDeciding transitions state', () => {
    useApprovals.getState().upsertPending(base);
    useApprovals.getState().markDeciding('tc1');
    expect(useApprovals.getState().pending.get('tc1')?.state).toBe('deciding');
  });

  it('markDeciding is a no-op for unknown id', () => {
    useApprovals.getState().markDeciding('nope');
    expect(useApprovals.getState().pending.size).toBe(0);
  });
});
