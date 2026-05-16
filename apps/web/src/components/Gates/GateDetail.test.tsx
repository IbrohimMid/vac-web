// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGates, type Gate, type GateId, type GateState } from '../../stores/gates';
import { useMutations } from '../../stores/mutations';
import { useSession } from '../../stores/session';
import { useCockpit } from '../../stores/cockpit';
import { GateDetail } from './GateDetail';

function gate(id: GateId, state: GateState): Gate {
  return {
    id,
    state,
    summary: '',
    blockers: [],
    criteria: [],
    signers: [],
    required_signers: 0,
    overridden: false,
    last_changed_at: '2026-01-01T00:00:00Z',
  };
}

const paramsMutation: Record<string, unknown> = { gateId: 'MutationAuditClean' };
const paramsReady: Record<string, unknown> = { gateId: 'ReadyToDeploy' };

function reset() {
  useGates.getState().clear();
  useMutations.getState().clear();
  useSession.setState({ sessionId: 'sess_01' });
  useCockpit.setState({ route: 'release' });
}

describe('<GateDetail/> MutationAuditClean (C2)', () => {
  beforeEach(reset);
  afterEach(cleanup);

  it('renders rich mutation rows for blocking intents', () => {
    useGates.getState().upsert(gate('MutationAuditClean', 'fail'));
    useMutations.getState().upsert({
      requestId: 'mut_failed_a',
      kind: 'bash',
      summary: 'Agent attempted blocked command',
      receivedAt: Date.now(),
      status: 'failed',
      sourceEventType: 'bridge.mutation.requested',
    });
    useMutations.getState().upsert({
      requestId: 'mut_pending_b',
      kind: 'edit',
      summary: 'Edit src/foo.ts',
      receivedAt: Date.now(),
      status: 'pending',
      sourceEventType: 'bridge.mutation.requested',
    });
    render(
      <GateDetail
        id="gd_test"
        params={paramsMutation}
        dismiss={() => undefined}
      />,
    );
    expect(screen.getByTestId('mutation-audit-blockers')).toBeInTheDocument();
    expect(screen.getByTestId('mutation-audit-lead')).toHaveTextContent(/2 mutasi/);
    expect(screen.getByTestId('mutation-audit-lead')).toHaveTextContent(/1 gagal/);
    const rows = screen.getAllByTestId('mutation-audit-blocker-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-request-id', 'mut_failed_a');
    expect(rows[0]).toHaveAttribute('data-status', 'failed');
    expect(screen.getByText('Agent attempted blocked command')).toBeInTheDocument();
  });

  it('Buka Mutation Inbox CTA routes to code and dismisses overlay', () => {
    useGates.getState().upsert(gate('MutationAuditClean', 'fail'));
    useMutations.getState().upsert({
      requestId: 'mut_pending_a',
      kind: 'write',
      summary: 'Write foo.ts',
      receivedAt: Date.now(),
      status: 'pending',
      sourceEventType: 'bridge.mutation.requested',
    });
    const dismiss = vi.fn();
    render(
      <GateDetail
        id="gd_test"
        params={paramsMutation}
        dismiss={dismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('mutation-audit-open-inbox'));
    expect(useCockpit.getState().route).toBe('code');
    expect(dismiss).toHaveBeenCalled();
  });

  it('falls back to generic blockers list for non-mutation gates', () => {
    const g = gate('ReadyToDeploy', 'fail');
    g.blockers = ['Dev not complete'];
    useGates.getState().upsert(g);
    render(
      <GateDetail
        id="gd_test"
        params={paramsReady}
        dismiss={() => undefined}
      />,
    );
    expect(screen.queryByTestId('mutation-audit-blockers')).not.toBeInTheDocument();
    expect(screen.getByText(/Dev not complete/)).toBeInTheDocument();
  });
});
