// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGates, type Gate, type GateId, type GateState } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import { useMutations } from '../../stores/mutations';
import { useSession } from '../../stores/session';
import { useOverlays } from '../../stores/overlays';
import type { TransportHandle } from '../../transport';
import { TargetCard } from './TargetCard';

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

type Targets = ReturnType<typeof useRelease.getState>['targets'];
type Target = Targets extends Map<string, infer V> ? V : never;

const target = {
  id: 't_prod',
  label: 'Prod web',
  environment: 'prod' as const,
  last_status: 'idle' as const,
  last_commit: 'abcdef1234567890',
  last_deployed_at: '2026-01-01T00:00:00Z',
} as unknown as Target;

function reset() {
  useRelease.getState().clear();
  useRelease.setState({ targets: new Map([[target.id as string, target]]) });
  useGates.getState().clear();
  useGates.getState().upsert(gate('DevComplete', 'pass'));
  useGates.getState().upsert(gate('ReadyToDeploy', 'pass'));
  useGates.getState().upsert(gate('ReadyToPublish', 'pass'));
  useMutations.getState().clear();
  useSession.setState({ sessionId: 'sess_01' });
}

function transportWith(send: (...args: unknown[]) => Promise<unknown>): TransportHandle {
  return {
    send: send as TransportHandle['send'],
    on: () => () => undefined,
    close: () => undefined,
  };
}

describe('TargetCard', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    useRelease.getState().clear();
    useGates.getState().clear();
    useOverlays.setState({ stack: [] });
  });

  it('enables Deploy via the affordance catalog when release.deploy is implemented', async () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(send)} />
      </ul>,
    );
    const deploy = screen.getByRole('button', { name: /^Deploy$/ });
    expect(deploy).toBeEnabled();
    expect(deploy.getAttribute('data-affordance-id')).toBe('release.deploy.button');
    expect(deploy).toHaveAttribute('title', '');
    fireEvent.click(deploy);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sess_01', 'release.deploy', { target_id: 't_prod' }),
    );
  });

  it('disables Publish via the affordance catalog when release gates are not ready', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd', ok: true }));
    useGates.getState().upsert(gate('ReadyToPublish', 'open'));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(send)} />
      </ul>,
    );
    const publish = screen.getByRole('button', { name: /^Publish$/ });
    expect(publish).toBeDisabled();
    expect(publish.getAttribute('data-affordance-id')).toBe('release.publish.button');
    expect(publish.getAttribute('title') ?? '').toMatch(/gate/i);
    fireEvent.click(publish);
    await waitFor(() => expect(send).not.toHaveBeenCalled());
    expect(
      screen.getByText(/Publish: Release publish gate is not ready\./),
    ).toHaveAttribute('tabindex', '0');
  });

  it('enables Release notes via the affordance catalog when release.generate_notes is implemented', async () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(send)} />
      </ul>,
    );
    const notes = screen.getByRole('button', { name: /^Release notes$/ });
    expect(notes).toBeEnabled();
    expect(notes.getAttribute('data-affordance-id')).toBe('release.generate_notes.button');
    fireEvent.click(notes);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sess_01', 'release.generate_notes', {
        target_id: 't_prod',
      }),
    );
  });

  it('renders blocked gates as keyboard-focusable buttons that open GateDetail', () => {
    useGates.getState().clear();
    useGates.getState().upsert(gate('DevComplete', 'pass'));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(vi.fn(async () => ({ ackOf: 'x', ok: true })))} />
      </ul>,
    );
    expect(screen.getByText(/Blocked by:/)).toBeInTheDocument();
    const gateButton = screen.getByRole('button', { name: 'Open ReadyToDeploy gate detail' });
    expect(gateButton).toHaveAttribute('data-testid', 'release-blocked-gate-ReadyToDeploy');
    fireEvent.click(gateButton);
    expect(useOverlays.getState().topmost()?.kind).toBe('gate_detail');
    expect(useOverlays.getState().topmost()?.params.gateId).toBe('ReadyToDeploy');
  });

  it('renders mutation count chip when MutationAuditClean blocks release (C2)', async () => {
    useMutations.getState().upsert({
      requestId: 'mut_pending_a',
      kind: 'edit',
      summary: 'Edit foo.ts',
      receivedAt: Date.now(),
      status: 'pending',
      sourceEventType: 'bridge.mutation.requested',
    });
    useMutations.getState().upsert({
      requestId: 'mut_failed_b',
      kind: 'bash',
      summary: 'Blocked bash',
      receivedAt: Date.now(),
      status: 'failed',
      sourceEventType: 'bridge.mutation.requested',
    });
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(vi.fn(async () => ({ ackOf: 'x', ok: true })))} />
      </ul>,
    );
    const chip = screen.getByTestId('release-blocked-gate-MutationAuditClean-count');
    expect(chip).toHaveTextContent('(2 mutations)');
  });

  it('blocks Deploy and Publish when mutation audit is not clean (C1)', async () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    useMutations.getState().upsert({
      requestId: 'mut_failed',
      kind: 'bash',
      summary: 'Agent attempted blocked command',
      receivedAt: Date.now(),
      status: 'failed',
      sourceEventType: 'bridge.mutation.requested',
    });
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(send)} />
      </ul>,
    );
    const deploy = screen.getByRole('button', { name: /^Deploy$/ });
    const publish = screen.getByRole('button', { name: /^Publish$/ });
    expect(deploy).toBeDisabled();
    expect(publish).toBeDisabled();
    const gateButton = screen.getByRole('button', { name: 'Open MutationAuditClean gate detail' });
    expect(gateButton).toHaveAttribute('data-testid', 'release-blocked-gate-MutationAuditClean');
    fireEvent.click(gateButton);
    expect(useOverlays.getState().topmost()?.kind).toBe('gate_detail');
    expect(useOverlays.getState().topmost()?.params.gateId).toBe('MutationAuditClean');
    await waitFor(() => expect(send).not.toHaveBeenCalled());
  });
});
