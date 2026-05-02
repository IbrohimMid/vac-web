// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FindingCard } from './FindingCard';
import { useAssessment, type Finding, type Run } from '../../stores/assessment';
import { useSession } from '../../stores/session';

afterEach(() => {
    cleanup();
    useAssessment.getState().clear();
    useSession.getState().clear();
});

describe('FindingCard', () => {
    it('shows the associated run query provenance badge', () => {
        const run: Run = {
            id: 'run_01',
            swarm: 'rtd',
            status: 'completed',
            started_at: '2026-01-01T00:00:00Z',
            finished_at: '2026-01-01T00:05:00Z',
            progress: { completed: 4, total: 4 },
            query_source: 'event_log',
            fallback_reason: 'index_incomplete',
        };
        const finding: Finding = {
            id: 'finding_01',
            identity_hash: 'hash_01',
            run_id: run.id,
            category: 'technical',
            subject: 'src/app.ts',
            check: 'lint',
            severity: 'medium',
            confidence: 0.9,
            title: 'Missing query provenance badge',
            summary: 'The finding should inherit the run query provenance badge.',
            evidence_ids: [],
            emitted_at: '2026-01-01T00:04:00Z',
        };

        useAssessment.getState().upsertRun(run);

        render(<FindingCard finding={finding} transport={null} />);

        const chip = screen.getByTestId('assessment-finding-provenance-chip');
        expect(chip).toHaveTextContent('Source: event log fallback');
        expect(chip).toHaveAttribute(
            'title',
            'Assessment read fell back to the canonical event log (index_incomplete).',
        );
    });
});
