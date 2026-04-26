// @vitest-environment happy-dom
// Render tests for the handoff packet detail controls. These lock the
// cockpit affordances to the bridge's canonical signer rules.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Ack, TransportHandle } from '../../transport';
import { useSession } from '../../stores/session';
import type { Packet } from '../../stores/handoff';
import { PacketDetail } from './PacketDetail';

function mkPacket(overrides: Partial<Packet> = {}): Packet {
  const base: Packet = {
    id: 'pkt_1',
    title: 'Packet title',
    summary: 'Packet summary',
    source_run_ids: ['run_1'],
    accepted_finding_ids: ['f1'],
    created_by: 'alice',
    created_at: '2026-01-01T00:00:00Z',
    pin: {
      repo_ref: 'branch:main',
      base_commit_sha: 'abc123def456',
      worktree_digest: 'digest-123',
      assessment_snapshot_at: '2026-01-01T00:00:00Z',
      connector_snapshots: [],
      expires_at: '2026-01-02T00:00:00Z',
      invalidate_on_repo_change: true,
      invalidation_policy: 'strict',
    },
    tasks: [],
    target: {
      kind: 'dispatch_to_local_vac',
      executor_profile_id: 'executor.code@1.0.0',
      session_title: 'Packet title',
    },
    approval: {
      required: true,
      approvers: [],
      two_party: true,
      required_roles: [],
    },
    status: 'pending_approval',
    state: 'pending_approval',
    state_history: [
      { state: 'draft', at: '2026-01-01T00:00:00Z', by: 'alice', reason: 'created' },
      {
        state: 'pending_approval',
        at: '2026-01-01T00:01:00Z',
        by: 'alice',
        reason: 'created',
      },
    ],
    signers: [{ name: 'alice', role: 'author', signed_at: '2026-01-01T00:00:00Z' }],
    required_signers: 2,
    convergence_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
  };

  return {
    ...base,
    ...overrides,
    pin: {
      ...base.pin,
      ...(overrides.pin ?? {}),
    },
    target: {
      ...base.target,
      ...(overrides.target ?? {}),
    },
    approval: {
      ...base.approval,
      ...(overrides.approval ?? {}),
    },
    source_run_ids: overrides.source_run_ids ?? base.source_run_ids,
    accepted_finding_ids: overrides.accepted_finding_ids ?? base.accepted_finding_ids,
    tasks: overrides.tasks ?? base.tasks,
    state_history: overrides.state_history ?? base.state_history,
    signers: overrides.signers ?? base.signers,
  };
}

function mockTransport(ack: Ack = { ackOf: 'cmd_1', ok: true }) {
  const send = vi.fn(async () => ack);
  const transport: TransportHandle = {
    send: send as TransportHandle['send'],
    on() {
      return () => {};
    },
    close() {},
  };

  return { transport, send };
}

describe('PacketDetail render', () => {
  beforeEach(() => {
    useSession.getState().clear();
    useSession.setState({ sessionId: 'sess1' });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends rejector and surfaces reject errors', async () => {
    const { transport, send } = mockTransport({
      ackOf: 'cmd_1',
      ok: false,
      error: { code: 'handoff.invalid_payload', message: 'reject failed' },
    });

    render(<PacketDetail packet={mkPacket()} transport={transport} />);

    fireEvent.change(screen.getByLabelText('Approver name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sess1', 'handoff.reject', {
        packet_id: 'pkt_1',
        rejector: 'Bob',
        reason: 'rejected',
      }),
    );
    await waitFor(() => expect(screen.getByText('reject failed')).toBeInTheDocument());
  });

  it('disables approve for case-variant self-sign', () => {
    const { transport } = mockTransport();

    render(<PacketDetail packet={mkPacket()} transport={transport} />);

    fireEvent.change(screen.getByLabelText('Approver name'), { target: { value: 'ALICE' } });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('disables approve for canonical duplicate signer variants', () => {
    const { transport } = mockTransport();

    render(
      <PacketDetail
        packet={mkPacket({
          required_signers: 3,
          signers: [
            { name: 'alice', role: 'author', signed_at: '2026-01-01T00:00:00Z' },
            { name: 'Bob', role: 'approver', signed_at: '2026-01-01T00:02:00Z' },
          ],
        })}
        transport={transport}
      />,
    );

    fireEvent.change(screen.getByLabelText('Approver name'), { target: { value: 'bob' } });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('shows executing packet progress and executor session id', () => {
    const { transport } = mockTransport();

    render(
      <PacketDetail
        packet={mkPacket({
          status: 'executing',
          state: 'executing',
          execution_session_id: 'sess_exec',
          execution_progress: {
            task_1: {
              task_id: 'task_1',
              status: 'started',
              updated_at: '2026-01-01T00:02:00Z',
              completed: 0,
              total: 1,
              message: 'bootstrapping',
            },
          },
        })}
        transport={transport}
      />,
    );

    expect(screen.getByText(/executor session:/i)).toHaveTextContent('sess_exec');
    expect(screen.getByText('Task progress')).toBeInTheDocument();
    expect(screen.getByText(/task_1/)).toBeInTheDocument();
    expect(screen.getByText(/bootstrapping/)).toBeInTheDocument();
  });

  it('shows completed execution outcome summary', () => {
    const { transport } = mockTransport();

    render(
      <PacketDetail
        packet={mkPacket({
          status: 'completed',
          state: 'completed',
          execution_session_id: 'sess_exec',
          execution_outcome: {
            status: 'success',
            tasks_completed: ['task_1'],
            tasks_failed: [],
            changeset_summary: 'mock execution complete',
            reassessment_run_id: 'run_1',
          },
        })}
        transport={transport}
      />,
    );

    expect(screen.getByText(/outcome:/)).toHaveTextContent('success');
    expect(screen.getByText(/completed: task_1/)).toBeInTheDocument();
    expect(screen.getByText(/summary: mock execution complete/)).toBeInTheDocument();
    expect(screen.getByText(/Reassessment can run next/)).toBeInTheDocument();
  });

  it('shows failed execution outcome and rollback hint', () => {
    const { transport } = mockTransport();

    render(
      <PacketDetail
        packet={mkPacket({
          status: 'failed',
          state: 'failed',
          execution_session_id: 'sess_exec',
          execution_outcome: {
            status: 'failed',
            tasks_completed: [],
            tasks_failed: ['task_1'],
            changeset_summary: 'mock execution failed',
          },
        })}
        transport={transport}
      />,
    );

    expect(screen.getByText(/outcome:/)).toHaveTextContent('failed');
    expect(screen.getByText(/failed: task_1/)).toBeInTheDocument();
    expect(screen.getByText(/Execution failed/)).toBeInTheDocument();
  });

  it('hides dispatch button once packet is dispatched', () => {
    const { transport } = mockTransport();

    render(
      <PacketDetail
        packet={mkPacket({
          status: 'dispatched',
          state: 'dispatched',
          execution_session_id: 'sess_exec',
        })}
        transport={transport}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Dispatch to executor' })).toBeNull();
  });
});
