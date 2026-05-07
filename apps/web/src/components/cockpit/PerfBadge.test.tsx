// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportHandle } from '../../transport';
import { usePerf } from '../../stores/perf';
import { PerfBadge } from './PerfBadge';

function mockTransport(send: TransportHandle['send']): TransportHandle {
  return {
    send,
    on: () => () => undefined,
    close: () => undefined,
  };
}

describe('PerfBadge', () => {
  beforeEach(() => {
    usePerf.getState().clear();
  });
  afterEach(() => {
    cleanup();
    usePerf.getState().clear();
  });

  it('renders unknown placeholder when no snapshot has landed', () => {
    render(<PerfBadge />);
    const badge = screen.getByTestId('perf-badge');
    expect(badge).toHaveTextContent('perf:');
    expect(badge).toHaveAttribute('data-perf-state', 'ok');
    expect(badge).toHaveAttribute('data-perf-status', 'unknown');
    expect(badge).toHaveAttribute('role', 'status');
  });

  it('reflects ok status from store', () => {
    usePerf.getState().setSnapshot({
      status: 'ok',
      latest: null,
      regressions: [],
    });
    render(<PerfBadge />);
    const badge = screen.getByTestId('perf-badge');
    expect(badge).toHaveTextContent('perf: ok');
    expect(badge).toHaveAttribute('data-perf-state', 'ok');
    expect(badge).toHaveAttribute('data-perf-status', 'ok');
  });

  it('reflects warn status from store', () => {
    usePerf.getState().setSnapshot({
      status: 'warn',
      latest: null,
      regressions: [],
    });
    render(<PerfBadge />);
    const badge = screen.getByTestId('perf-badge');
    expect(badge).toHaveTextContent('perf: warn');
    expect(badge).toHaveAttribute('data-perf-state', 'warn');
  });

  it('dispatches perf.latest_run on mount when transport is provided and requestStatus is idle', () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    const transport = mockTransport(send as unknown as TransportHandle['send']);
    render(<PerfBadge transport={transport} />);
    expect(send).toHaveBeenCalledWith('', 'perf.latest_run', {});
  });

  it('does not dispatch when transport is null', () => {
    render(<PerfBadge transport={null} />);
    expect(screen.getByTestId('perf-badge')).toBeInTheDocument();
  });
});
