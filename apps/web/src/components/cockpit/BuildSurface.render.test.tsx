// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BuildSurface } from './BuildSurface';
import type { TransportHandle } from '../../transport';
import { useSession } from '../../stores/session';

const transport = { send: vi.fn(), close: vi.fn(), status: 'open' } as unknown as TransportHandle;

describe('BuildSurface workbench accessibility', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses semantic keyboardable tabs for the workbench', () => {
    useSession.setState({ sessionId: 'sess1' });
    render(<BuildSurface transport={transport} />);
    expect(screen.getByRole('tablist', { name: 'Workbench sections' })).toBeInTheDocument();
    const approvals = screen.getByRole('tab', { name: /Approvals/i });
    expect(approvals).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(approvals, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Review/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'workbench-tab-review');
  });
});
