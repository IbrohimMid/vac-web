// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReadinessHub } from './ReadinessHub';
import { useAssessment, type Run } from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

afterEach(() => {
    cleanup();
    useAssessment.getState().clear();
    useSession.getState().clear();
});

function mkRun(overrides: Partial<Run> = {}): Run {
    return {
        id: 'run_01',
        swarm: 'rtd',
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:05:00Z',
        progress: { completed: 4, total: 4 },
        verdict: 'pass',
        query_source: 'event_log',
        fallback_reason: 'index_missing',
        ...overrides,
    };
}

describe('ReadinessHub', () => {
    it('surfaces query provenance in the active run header', () => {
        const transport: TransportHandle | null = null;
        useAssessment.getState().upsertRun(mkRun());

        render(<ReadinessHub transport={transport} />);

        const chip = screen.getAllByTestId('assessment-provenance-chip')[0];
        expect(chip).toHaveTextContent('Source: event log fallback');
        expect(chip).toHaveAttribute(
            'title',
            'Assessment read fell back to the canonical event log (index_missing).',
        );
    });
});
