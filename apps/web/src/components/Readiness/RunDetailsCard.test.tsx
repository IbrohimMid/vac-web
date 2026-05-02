// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RunDetailsCard } from './RunDetailsCard';
import type { Run } from '../../stores/assessment';

afterEach(cleanup);

describe('RunDetailsCard', () => {
  it('shows validated and rejected candidate summaries', () => {
    const run: Run = {
      id: 'run_01',
      swarm: 'rtd',
      status: 'running',
      started_at: '2026-01-01T00:00:00Z',
      progress: { completed: 2, total: 4 },
      query_source: 'index',
      fallback_reason: null,
      validation: {
        received: 3,
        rejected: 1,
        rejection_reasons: {
          missing_evidence: 1,
        },
      },
    };

    render(<RunDetailsCard run={run} validatedFindings={2} />);

    expect(screen.getByText('Validated')).toBeInTheDocument();
    expect(screen.getByText('2 findings')).toBeInTheDocument();
    expect(screen.getByTestId('assessment-provenance-chip')).toHaveTextContent('Source: index');
    expect(screen.getByText('Candidates')).toBeInTheDocument();
    expect(screen.getByText('3 candidates')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('1 candidate')).toBeInTheDocument();
    expect(screen.getByText('missing_evidence (1)')).toBeInTheDocument();
  });
});
