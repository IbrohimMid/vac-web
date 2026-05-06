// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRelease } from '../../stores/release';
import { ObservationsFeed } from './ObservationsFeed';

const reset = () => useRelease.getState().clear();

describe('ObservationsFeed', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('renders nothing when observations are empty', () => {
    const { container } = render(<ObservationsFeed />);
    expect(container.firstChild).toBeNull();
  });

  it('renders observations newest-first with severity attribute when state is appended', () => {
    type Obs = ReturnType<typeof useRelease.getState>['observations'][number];
    const o1 = {
      id: 'o1',
      connector: 'sentry',
      message: 'old issue',
      observed_at: '2026-01-01T00:00:00Z',
      severity: 'info',
    } as unknown as Obs;
    const o2 = {
      id: 'o2',
      connector: 'datadog',
      message: 'spike detected',
      observed_at: '2026-01-02T00:00:00Z',
      severity: 'warn',
    } as unknown as Obs;
    act(() => {
      useRelease.setState({ observations: [o1, o2] });
    });
    render(<ObservationsFeed />);
    const items = Array.from(
      screen.getByTestId('observations-feed').querySelectorAll('li'),
    );
    expect(items.length).toBe(2);
    const first = items[0];
    const second = items[1];
    if (!first || !second) throw new Error('expected two rendered rows');
    expect(first.textContent).toContain('spike detected');
    expect(first.getAttribute('data-severity')).toBe('warn');
    expect(second.getAttribute('data-severity')).toBe('info');
  });
});
