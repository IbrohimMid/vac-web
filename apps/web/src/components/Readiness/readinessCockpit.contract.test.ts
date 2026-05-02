// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const CONTRACT = [
    {
        file: 'ReadinessHub.tsx',
        needles: [
            'assessment-family-select',
            'run-assessment-button',
            'assessment-cancel-button',
            'assessment-query-error-banner',
            'assessment-query-error-retry',
            'assessment-active-run-select',
            'assessment-sweep-row',
            'assessment-sweep-cancel-button',
            'assessment-run-row',
            'assessment-provenance-chip',
        ],
    },
    {
        file: 'AssessmentDiff.tsx',
        needles: ['assessment-diff-view'],
    },
    {
        file: 'AssessmentReportDetail.tsx',
        needles: [
            'assessment-report-detail',
            'assessment-worker-output-rejection',
            'assessment-worker-output-reason',
        ],
    },
    {
        file: 'RunDetailsCard.tsx',
        needles: ['data-testid="assessment-provenance-chip"'],
    },
    {
        file: 'FindingsList.tsx',
        needles: ['assessment-findings-list'],
    },
    {
        file: 'FindingCard.tsx',
        needles: ['assessment-finding-provenance-chip'],
    },
    {
        file: 'AssessmentProvenanceChip.tsx',
        needles: ['data-testid={testId}'],
    },
] as const;

function source(file: string): string {
    return readFileSync(join(HERE, file), 'utf8');
}

describe('readiness cockpit testid contract', () => {
    for (const { file, needles } of CONTRACT) {
        it(`keeps the stable testid hooks in ${file}`, () => {
            const text = source(file);

            for (const needle of needles) {
                expect(text).toContain(needle);
            }
        });
    }
});
