// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '../../../../scripts/verify-assessment-cockpit.sh');

describe('verify-assessment-cockpit.sh', () => {
    it('runs the focused assessment regression suite', () => {
        const text = readFileSync(SCRIPT, 'utf8');

        expect(text).toContain('pnpm --filter @vac-web/web typecheck');
        expect(text).toContain('src/components/Readiness/readinessCockpit.contract.test.ts');
        expect(text).toContain('src/components/Readiness/RunDetailsCard.test.tsx');
        expect(text).toContain('src/components/Readiness/AssessmentReportDetail.test.tsx');
        expect(text).toContain('src/scripts/verifyAssessmentCockpit.test.ts');
        expect(text).toContain('src/stores/assessment.test.ts');
    });
});
