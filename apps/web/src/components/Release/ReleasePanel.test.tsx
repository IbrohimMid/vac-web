// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGates } from '../../stores/gates';
import { useRelease } from '../../stores/release';
import { useSession } from '../../stores/session';
import { ReleasePanel } from './ReleasePanel';

function reset() {
  useRelease.getState().clear();
  useGates.getState().clear();
  useSession.setState({ sessionId: 'sess_01' });
}

describe('ReleasePanel', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('shows the empty-targets copy when no targets are configured', () => {
    render(<ReleasePanel transport={null} />);
    expect(screen.getByText(/No deploy targets configured/)).toBeInTheDocument();
  });

  it('renders a TargetCard live when setTargets is dispatched after mount', () => {
    render(<ReleasePanel transport={null} />);
    type Targets = ReturnType<typeof useRelease.getState>['targets'];
    type Target = Targets extends Map<string, infer V> ? V : never;
    const target = {
      id: 't_prod',
      label: 'Prod web',
      environment: 'prod',
      last_status: 'idle',
      last_commit: 'abcdef1234567890',
    } as unknown as Target;
    act(() => {
      useRelease.setState({ targets: new Map([['t_prod', target]]) });
    });
    expect(screen.getByText(/Prod web/)).toBeInTheDocument();
    expect(screen.getByTestId('release-target-t_prod')).toBeInTheDocument();
  });
});
