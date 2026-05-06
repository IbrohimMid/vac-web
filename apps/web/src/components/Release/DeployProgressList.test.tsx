// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRelease } from '../../stores/release';
import { DeployProgressList } from './DeployProgressList';

const reset = () => useRelease.getState().clear();

type Deploys = ReturnType<typeof useRelease.getState>['deploys'];
type Deploy = Deploys extends Map<string, infer V> ? V : never;

describe('DeployProgressList', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('renders the empty-state copy when no deploys are present', () => {
    render(<DeployProgressList />);
    expect(screen.getByText(/No deploys yet/)).toBeInTheDocument();
  });

  it('renders deploy rows newest-first when the store is updated', () => {
    const d1 = {
      id: 'd1',
      target_id: 't1',
      commit: 'aaaaaaaa11111111',
      status: 'deployed',
      finished_at: '2026-01-01T00:01:00Z',
    } as unknown as Deploy;
    const d2 = {
      id: 'd2',
      target_id: 't1',
      commit: 'bbbbbbbb22222222',
      status: 'deploying',
    } as unknown as Deploy;
    act(() => {
      useRelease.setState({
        deploys: new Map([
          ['d1', d1],
          ['d2', d2],
        ]),
        deployOrder: ['d1', 'd2'],
      });
    });
    render(<DeployProgressList />);
    const items = Array.from(
      screen.getByTestId('deploy-progress-list').querySelectorAll('li'),
    );
    expect(items.length).toBe(2);
    const first = items[0];
    const second = items[1];
    if (!first || !second) throw new Error('expected two rendered rows');
    expect(first.textContent).toContain('bbbbbbbb');
    expect(second.textContent).toContain('aaaaaaaa');
    expect(first.getAttribute('data-status')).toBe('deploying');
  });
});
