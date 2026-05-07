// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExtensions } from '../../../stores/extensions';
import { useSession } from '../../../stores/session';
import type { TransportHandle } from '../../../transport';
import { PendingApprovals } from './PendingApprovals';

const SAMPLE_REQUEST = {
  request_id: 'req-1',
  extension_id: 'ext-foo',
  requested_tier: 'allowed_signed' as const,
  requested_by_session_id: 'sess-A',
  requested_by_profile_id: 'profile-A',
  created_at: '2026-05-07T12:00:00Z',
  status: 'pending' as const,
  decided_at: null,
  decided_by_session_id: null,
  decided_by_profile_id: null,
};

function stubTransport(): TransportHandle {
  return {
    send: vi.fn().mockResolvedValue({ ok: true }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as TransportHandle;
}

describe('PendingApprovals', () => {
  beforeEach(() => {
    useExtensions.getState().clear();
    useSession.setState({ sessionId: 'sess-B' });
  });
  afterEach(() => {
    cleanup();
    useExtensions.getState().clear();
    useSession.setState({ sessionId: null });
  });

  it('renders nothing when there are no approvals and status is idle', () => {
    const { container } = render(<PendingApprovals transport={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per pending request with an approve action', () => {
    useExtensions.getState().setApprovalsSnapshot({
      requests: [SAMPLE_REQUEST],
    });
    render(<PendingApprovals transport={stubTransport()} />);
    expect(screen.getByTestId('pending-approvals')).toBeInTheDocument();
    expect(
      screen.getByTestId('pending-approval-row-req-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('pending-approval-approve-req-1'),
    ).not.toBeDisabled();
  });

  it('disables approve when current session is the requester', () => {
    useSession.setState({ sessionId: 'sess-A' });
    useExtensions.getState().setApprovalsSnapshot({
      requests: [SAMPLE_REQUEST],
    });
    render(<PendingApprovals transport={stubTransport()} />);
    expect(
      screen.getByTestId('pending-approval-approve-req-1'),
    ).toBeDisabled();
  });

  it('dispatches extensions.approve_promotion on approve click', () => {
    const transport = stubTransport();
    useExtensions.getState().setApprovalsSnapshot({
      requests: [SAMPLE_REQUEST],
    });
    render(<PendingApprovals transport={transport} />);
    fireEvent.click(
      screen.getByTestId('pending-approval-approve-req-1'),
    );
    expect(transport.send).toHaveBeenCalledWith(
      'sess-B',
      'extensions.approve_promotion',
      { request_id: 'req-1' },
    );
  });

  it('hides resolved (approved/denied) requests', () => {
    useExtensions.getState().setApprovalsSnapshot({
      requests: [
        { ...SAMPLE_REQUEST, status: 'approved', request_id: 'req-done' },
      ],
    });
    const { container } = render(
      <PendingApprovals transport={stubTransport()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
