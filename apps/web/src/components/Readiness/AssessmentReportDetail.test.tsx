// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssessmentReportDetail } from './AssessmentReportDetail';
import { useAssessment, type Run, type WorkerOutputRejection } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

function mkRun(overrides: Partial<Run> = {}): Run {
    return {
        id: 'run_1',
        swarm: 'rtd',
        status: 'running',
        started_at: '2026-01-01T00:00:00Z',
        progress: { completed: 0, total: 1 },
        ...overrides,
    };
}

function mkTransport() {
    const send = vi.fn(async () => ({ ackOf: 'cmd_1', ok: true }));
    const transport: TransportHandle = {
        send: send as TransportHandle['send'],
        on() {
            return () => { };
        },
        close() { },
    };
    return { transport, send };
}

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
}

function resetStores() {
    useAssessment.getState().clear();
    useAssessmentReport.getState().clear();
    useSession.getState().clear();
    useCockpit.getState().setRoute('build');
}

describe('AssessmentReportDetail', () => {
    beforeEach(resetStores);

    afterEach(() => {
        cleanup();
        delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
        vi.restoreAllMocks();
    });

    it('renders a dedicated worker-output rejection banner and replay action', async () => {
        const { transport, send } = mkTransport();
        const run = mkRun();
        useAssessment.getState().upsertRun(run);
        useAssessment.getState().recordQueryFailure({
            action: 'fetch_report',
            reason: 'event_log_truncated',
            message: 'query failure should stay separate',
            ts: '2026-01-01T00:00:00Z',
            targetId: run.id,
        });
        useAssessment.getState().recordWorkerOutputRejection({
            run_id: run.id,
            worker_session_id: 'worker_1',
            agent_id: 'agent_1',
            agent_kind: 'acp',
            agent_role: 'assessment-worker',
            reason: 'schema_version_unsupported',
            code: 'schema_version_unsupported',
            detail: 'unsupported worker output schema_version 99',
            path: 'schema_version',
            ts: '2026-01-01T00:00:00Z',
        });
        useSession.setState({ sessionId: 'sess1' });

        render(<AssessmentReportDetail runId={run.id} onBack={() => { }} transport={transport} />);

        expect(screen.getByTestId('assessment-worker-output-rejection')).toBeInTheDocument();
        expect(screen.getByText('Worker output rejected — Unsupported schema version')).toBeInTheDocument();
        expect(screen.getByTestId('assessment-worker-output-reason')).toHaveTextContent(
            'schema_version_unsupported',
        );
        expect(screen.queryByTestId('assessment-query-error-banner')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy diagnostic' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Replay' }));

        await waitFor(() =>
            expect(send).toHaveBeenCalledWith('sess1', 'assessment.replay', { run_id: run.id }),
        );
    });

    it('surfaces query provenance in the report header', () => {
        const { transport } = mkTransport();
        const run = mkRun({ query_source: 'index', fallback_reason: null });
        useAssessment.getState().upsertRun(run);

        render(<AssessmentReportDetail runId={run.id} onBack={() => { }} transport={transport} />);

        const chip = screen.getAllByTestId('assessment-provenance-chip')[0];
        expect(chip).toHaveTextContent('Source: index');
        expect(chip).toHaveAttribute('title', 'Assessment read served from the SQLite index.');
    });

    it('copies a sanitized worker-output diagnostic for redacted samples', async () => {
        const { transport, send } = mkTransport();
        const clipboardWrite = vi.fn(async (_text: string) => undefined);
        setClipboard(clipboardWrite);

        const run = mkRun();
        const rejection: WorkerOutputRejection = {
            run_id: run.id,
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
            sample: 'Bearer SECRET_TOKEN should never appear in clipboard output',
            pass: 2,
            max_passes: 4,
            ts: '2026-01-01T00:00:00Z',
        };
        useAssessment.getState().upsertRun(run);
        useAssessment.getState().recordWorkerOutputRejection(rejection);
        useSession.setState({ sessionId: 'sess1' });

        render(<AssessmentReportDetail runId={run.id} onBack={() => { }} transport={transport} />);

        expect(screen.getByRole('button', { name: 'Copy diagnostic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic' }));

        await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
        const diagnostic = clipboardWrite.mock.calls[0]?.[0] ?? '';
        expect(diagnostic).toContain('assessment.worker_output_rejected');
        expect(diagnostic).toContain('normalized_reason: redaction_applied');
        expect(diagnostic).toContain('reason_label: Diagnostic redacted');
        expect(diagnostic).toContain('reason_detail: Sensitive content was removed from the diagnostic sample.');
        expect(diagnostic).toContain('sample: [redacted and truncated for safety]');
        expect(diagnostic).toContain('sample_reason: redaction_applied');
        expect(diagnostic).toContain('sample_truncated: true');
        expect(diagnostic).toContain('backend_detail: sensitive content removed');
        expect(diagnostic).not.toContain('Bearer SECRET_TOKEN should never appear in clipboard output');
        expect(send).not.toHaveBeenCalled();
    });
});
