// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGates, type Gate, type GateId, type GateState } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import { useSession } from '../../stores/session';
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
  });

  it('reflects the affordance catalog: Deploy button is disabled with the catalog\u2019s reason when release.deploy is not_wired', () => {
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(vi.fn(async () => ({ ackOf: 'x', ok: true })))} />
      </ul>,
    );
    const deploy = screen.getByRole('button', { name: /^Deploy$/ });
    expect(deploy).toBeDisabled();
    expect(deploy.getAttribute('data-affordance-id')).toBe('release.deploy.button');
    // Title carries the affordance disabled-reason; assert it is present and non-empty
    // so the catalog wiring is exercised end-to-end.
    expect(deploy.getAttribute('title') ?? '').not.toBe('');
  });

  it('disables Publish via the affordance catalog when release.publish is not_wired', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd', ok: true }));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(send)} />
      </ul>,
    );
    const publish = screen.getByRole('button', { name: /^Publish$/ });
    expect(publish).toBeDisabled();
    expect(publish.getAttribute('data-affordance-id')).toBe('release.publish.button');
    expect(publish.getAttribute('title') ?? '').toMatch(/not wired/i);
    fireEvent.click(publish);
    await waitFor(() => expect(send).not.toHaveBeenCalled());
  });

  it('disables Release notes via the affordance catalog when release.generate_notes is not_wired', () => {
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(vi.fn(async () => ({ ackOf: 'x', ok: true })))} />
      </ul>,
    );
    const notes = screen.getByRole('button', { name: /^Release notes$/ });
    expect(notes).toBeDisabled();
    expect(notes.getAttribute('data-affordance-id')).toBe('release.generate_notes.button');
  });

  it('shows blocked reason when ReadyToDeploy gate is missing', () => {
    useGates.getState().clear();
    useGates.getState().upsert(gate('DevComplete', 'pass'));
    render(
      <ul>
        <TargetCard targetId="t_prod" transport={transportWith(vi.fn(async () => ({ ackOf: 'x', ok: true })))} />
      </ul>,
    );
    expect(screen.getByText(/Blocked by:/)).toBeInTheDocument();
    expect(screen.getByText(/ReadyToDeploy/)).toBeInTheDocument();
  });
});
