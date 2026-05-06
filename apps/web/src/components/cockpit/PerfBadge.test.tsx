// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { PerfBadge } from './PerfBadge';

describe('PerfBadge', () => {
  afterEach(() => cleanup());

  it('renders default ok state with perf: ok label', () => {
    render(<PerfBadge />);
    const badge = screen.getByTestId('perf-badge');
    expect(badge).toHaveTextContent('perf: ok');
    expect(badge).toHaveAttribute('data-perf-state', 'ok');
    expect(badge).toHaveAttribute('role', 'status');
  });

  it('honors state and custom label props', () => {
    render(<PerfBadge state='warn' label='perf drift' />);
    const badge = screen.getByTestId('perf-badge');
    expect(badge).toHaveTextContent('perf drift');
    expect(badge).toHaveAttribute('data-perf-state', 'warn');
  });
});
