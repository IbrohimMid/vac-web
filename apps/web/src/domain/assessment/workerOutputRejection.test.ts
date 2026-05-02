import { describe, expect, it } from 'vitest';
import {
    formatWorkerOutputDiagnostic,
    normalizeWorkerOutputReason,
    parseWorkerOutputRejection,
    workerOutputActionLabels,
} from './workerOutputRejection';

describe('workerOutputRejection helpers', () => {
    it('normalizes legacy codes to stable reasons and preserves safe metadata in copy text', () => {
        expect(normalizeWorkerOutputReason('json_parse_failed', undefined)).toBe('json_parse_failed');
        expect(normalizeWorkerOutputReason(undefined, 'candidate_missing_title')).toBe(
            'candidate_schema_invalid',
        );
        expect(normalizeWorkerOutputReason(undefined, 'schema_version_invalid')).toBe('schema_invalid');
    });

    it('parses worker-output rejection payloads with stable reasons and safe copy formatting', () => {
        const rejection = parseWorkerOutputRejection(
            {
                run_id: 'run_1',
                worker_session_id: 'worker_1',
                agent_id: 'agent_1',
                agent_kind: 'acp',
                agent_role: 'assessment-worker',
                reason: 'redaction_applied',
                code: 'redaction_applied',
                detail: 'sensitive content removed',
                path: 'candidates[0].title',
                sample_reason: 'redaction_applied',
                sample_truncated: true,
                sample: 'Bearer SECRET_TOKEN should never escape',
                pass: 2,
                max_passes: 5,
            },
            '2026-01-01T00:00:00Z',
        );

        expect(rejection?.reason).toBe('redaction_applied');
        expect(rejection?.sample_reason).toBe('redaction_applied');
        expect(rejection?.sample_truncated).toBe(true);
        expect(rejection?.sample).toBe('Bearer SECRET_TOKEN should never escape');

        const diagnostic = rejection ? formatWorkerOutputDiagnostic(rejection) : '';
        expect(diagnostic).toContain('normalized_reason: redaction_applied');
        expect(diagnostic).toContain('reason_label: Diagnostic redacted');
        expect(diagnostic).toContain('reason_detail: Sensitive content was removed from the diagnostic sample.');
        expect(diagnostic).toContain('sample_reason: redaction_applied');
        expect(diagnostic).toContain('sample_truncated: true');
        expect(diagnostic).toContain('pass: 2');
        expect(diagnostic).toContain('max_passes: 5');
        expect(diagnostic).toContain('path: candidates[0].title');
        expect(diagnostic).toContain('sample: [redacted and truncated for safety]');
        expect(diagnostic).toContain('backend_detail: sensitive content removed');
        expect(diagnostic).not.toContain('Bearer SECRET_TOKEN should never escape');
    });

    it('keeps action labels aligned with the stable reason taxonomy', () => {
        expect(workerOutputActionLabels('schema_version_unsupported')).toEqual({
            primary: 'Replay',
            secondary: 'Copy diagnostic',
        });
        expect(workerOutputActionLabels('redaction_applied')).toEqual({
            primary: 'Copy diagnostic',
            secondary: 'Replay',
        });
    });
});
