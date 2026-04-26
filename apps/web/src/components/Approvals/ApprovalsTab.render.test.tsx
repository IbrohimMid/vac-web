// @vitest-environment happy-dom
// Render tests for the approvals tab migration to approval_id-based bridge events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useApprovals } from '../../stores/approvals';
import { useSession } from '../../stores/session';
import { ApprovalsTab } from './ApprovalsTab';
import type { TransportHandle } from '../../transport';

function resetStores() {
  useApprovals.setState({
    pending: new Map(),
    pendingOrder: [],
    resolved: new Map(),
    resolvedOrder: [],
  });
  useSession.setState({ sessionId: 'sess1' });
}

function seedPending() {
  useApprovals.getState().upsertPending({
    approvalId: 'appr_01',
    toolCallId: 'tc1',
    tool: 'Write hello.md',
    risk: 'high',
    summary: '/repo/hello.md',
    args: { file_path: '/repo/hello.md', content: 'hello from acp\n' },
    createdAt: '2026-01-01T00:00:00Z',
    sourceEventType: 'approval.pending',
    toolCall: {
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Write hello.md',
      rawInput: { file_path: '/repo/hello.md', content: 'hello from acp\n' },
    },
    state: 'pending',
    expiresInMs: 60000,
    options: [
      { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
      { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
    ],
  });
}

describe('ApprovalsTab render', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('sends approval_id on approve', async () => {
    seedPending();
    const send = vi.fn(async () => ({ ackOf: 'cmd_1', ok: true }));
    const transport: TransportHandle = {
      send: send as TransportHandle['send'],
      on() {
        return () => {};
      },
      close() {},
    };

    render(<ApprovalsTab transport={transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('sess1', 'approval.approve', { approval_id: 'appr_01' });
  });

  it('renders resolved approvals as visible history', () => {
    seedPending();
    useApprovals.getState().resolve({
      approvalId: 'appr_01',
      decision: 'approved',
      outcome: 'approved',
      optionId: 'allow',
      resolvedAt: '2026-01-01T00:00:01Z',
      sourceEventType: 'approval.resolved',
    });

    render(<ApprovalsTab transport={null} />);
    expect(screen.getByText('Resolved approvals (1)')).toBeInTheDocument();
    expect(screen.getByText(/resolved: approved · option allow/)).toBeInTheDocument();
  });
});
