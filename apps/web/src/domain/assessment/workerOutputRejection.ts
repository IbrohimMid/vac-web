import type {
    WorkerOutputRejection,
    WorkerOutputRejectionReason,
} from '../../stores/assessment';

const WORKER_OUTPUT_REASON_LABELS: Record<WorkerOutputRejectionReason, string> = {
    json_parse_failed: 'Unparseable worker output',
    schema_version_unsupported: 'Unsupported schema version',
    schema_invalid: 'Invalid worker schema',
    candidate_schema_invalid: 'Invalid candidate payload',
    empty_output: 'Empty worker output',
    redaction_applied: 'Diagnostic redacted',
};

const WORKER_OUTPUT_REASON_DETAILS: Record<WorkerOutputRejectionReason, string> = {
    json_parse_failed: 'The worker did not return valid JSON.',
    schema_version_unsupported:
        'The worker emitted a schema version this bridge does not support.',
    schema_invalid: 'The worker envelope is missing required top-level fields or has the wrong shape.',
    candidate_schema_invalid: 'One or more candidate payloads are malformed.',
    empty_output: 'The worker returned no output.',
    redaction_applied: 'Sensitive content was removed from the diagnostic sample.',
};

const WORKER_OUTPUT_ACTION_LABELS: Record<WorkerOutputRejectionReason, string> = {
    json_parse_failed: 'Run again',
    schema_version_unsupported: 'Replay',
    schema_invalid: 'Replay',
    candidate_schema_invalid: 'Replay',
    empty_output: 'Run again',
    redaction_applied: 'Copy diagnostic',
};

const WORKER_OUTPUT_REASONS = new Set<WorkerOutputRejectionReason>([
    'json_parse_failed',
    'schema_version_unsupported',
    'schema_invalid',
    'candidate_schema_invalid',
    'empty_output',
    'redaction_applied',
]);

const WORKER_OUTPUT_REASON_BY_CODE: Record<string, WorkerOutputRejectionReason> = {
    unparseable: 'json_parse_failed',
    json_parse_failed: 'json_parse_failed',
    empty_output: 'empty_output',
    schema_version_invalid: 'schema_invalid',
    schema_version_unsupported: 'schema_version_unsupported',
    missing_candidates: 'schema_invalid',
    candidates_not_array: 'schema_invalid',
    candidate_not_object: 'candidate_schema_invalid',
    candidate_missing_title: 'candidate_schema_invalid',
    candidate_severity_invalid: 'candidate_schema_invalid',
    schema_invalid: 'schema_invalid',
    candidate_schema_invalid: 'candidate_schema_invalid',
    redaction_applied: 'redaction_applied',
};

export function isWorkerOutputRejectionReason(
    value: string | undefined | null,
): value is WorkerOutputRejectionReason {
    return typeof value === 'string' && WORKER_OUTPUT_REASONS.has(value as WorkerOutputRejectionReason);
}

export function normalizeWorkerOutputReason(
    reason: string | undefined | null,
    code?: string,
): WorkerOutputRejectionReason {
    if (isWorkerOutputRejectionReason(reason)) return reason;
    if (code) {
        const mapped = WORKER_OUTPUT_REASON_BY_CODE[code];
        if (mapped) return mapped;
    }
    return 'schema_invalid';
}

export function workerOutputDiagnosticTitle(reason: WorkerOutputRejectionReason): string {
    return workerOutputReasonLabel(reason);
}

export function workerOutputDiagnosticAction(reason: WorkerOutputRejectionReason): string {
    return workerOutputPrimaryActionLabel(reason);
}

export function workerOutputReasonLabel(reason: WorkerOutputRejectionReason): string {
    return WORKER_OUTPUT_REASON_LABELS[reason];
}

export function workerOutputReasonDetail(reason: WorkerOutputRejectionReason): string {
    return WORKER_OUTPUT_REASON_DETAILS[reason];
}

export function workerOutputPrimaryActionLabel(reason: WorkerOutputRejectionReason): string {
    return WORKER_OUTPUT_ACTION_LABELS[reason];
}

export function workerOutputActionLabels(reason: WorkerOutputRejectionReason): {
    primary: string;
    secondary: string;
} {
    const primary = workerOutputPrimaryActionLabel(reason);
    return {
        primary,
        secondary: primary === 'Copy diagnostic' ? 'Replay' : 'Copy diagnostic',
    };
}

function readString(raw: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

function readBoolean(raw: Record<string, unknown>, keys: string[]): boolean | undefined {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === 'boolean') return value;
    }
    return undefined;
}

function readOptionalNumber(raw: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    }
    return undefined;
}

export function parseWorkerOutputRejection(
    raw: unknown,
    ts = new Date().toISOString(),
): WorkerOutputRejection | null {
    const p = raw as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;

    const runId = readString(p, ['run_id', 'runId']);
    if (!runId) return null;

    const reason = normalizeWorkerOutputReason(readString(p, ['reason']), readString(p, ['code']));
    const code = readString(p, ['code']) ?? reason;
    const detail =
        readString(p, ['detail', 'message']) ??
        workerOutputReasonDetail(reason) ??
        'Worker output rejected.';
    const workerSessionId = readString(p, ['worker_session_id', 'workerSessionId']);
    const agentId = readString(p, ['agent_id', 'agentId']);
    const agentKind = readString(p, ['agent_kind', 'agentKind']);
    const agentRole = readString(p, ['agent_role', 'agentRole']);
    const path = readString(p, ['path']);
    const sample = readString(p, ['sample']);
    const sampleReasonRaw = readString(p, ['sample_reason', 'sampleReason']);
    const sampleReason =
        sampleReasonRaw && isWorkerOutputRejectionReason(sampleReasonRaw)
            ? sampleReasonRaw
            : undefined;
    const sampleTruncated = readBoolean(p, ['sample_truncated', 'sampleTruncated']);
    const pass = readOptionalNumber(p, ['pass']);
    const maxPasses = readOptionalNumber(p, ['max_passes', 'maxPasses']);

    return {
        run_id: runId,
        ...(workerSessionId !== undefined ? { worker_session_id: workerSessionId } : {}),
        ...(agentId !== undefined ? { agent_id: agentId } : {}),
        ...(agentKind !== undefined ? { agent_kind: agentKind } : {}),
        ...(agentRole !== undefined ? { agent_role: agentRole } : {}),
        reason,
        code,
        detail,
        ...(path !== undefined ? { path } : {}),
        ...(sampleReason !== undefined ? { sample_reason: sampleReason } : {}),
        ...(sampleTruncated !== undefined ? { sample_truncated: sampleTruncated } : {}),
        ...(pass !== undefined ? { pass } : {}),
        ...(maxPasses !== undefined ? { max_passes: maxPasses } : {}),
        ...(sample !== undefined ? { sample } : {}),
        ts,
    };
}

function workerOutputSampleSafetyNote(rejection: WorkerOutputRejection): string | null {
    const notes: string[] = [];
    if (rejection.sample_reason === 'redaction_applied') notes.push('redacted');
    if (rejection.sample_truncated) notes.push('truncated');
    if (notes.length > 0) return `[${notes.join(' and ')} for safety]`;
    if (rejection.sample && rejection.sample.length > 0) return '[omitted for safety]';
    return null;
}

export function formatWorkerOutputDiagnostic(rejection: WorkerOutputRejection): string {
    const reasonDetail = workerOutputReasonDetail(rejection.reason);
    const lines = [
        'assessment.worker_output_rejected',
        `run_id: ${rejection.run_id}`,
        `normalized_reason: ${rejection.reason}`,
        `reason_label: ${workerOutputReasonLabel(rejection.reason)}`,
        `reason_detail: ${reasonDetail}`,
        `code: ${rejection.code}`,
        `recommended_action: ${workerOutputPrimaryActionLabel(rejection.reason)}`,
    ];
    if (rejection.worker_session_id) lines.push(`worker_session_id: ${rejection.worker_session_id}`);
    if (rejection.agent_id) lines.push(`agent_id: ${rejection.agent_id}`);
    if (rejection.agent_kind) lines.push(`agent_kind: ${rejection.agent_kind}`);
    if (rejection.agent_role) lines.push(`agent_role: ${rejection.agent_role}`);
    if (rejection.detail && rejection.detail !== reasonDetail) {
        lines.push(`backend_detail: ${rejection.detail}`);
    }
    if (rejection.sample_reason) lines.push(`sample_reason: ${rejection.sample_reason}`);
    if (typeof rejection.sample_truncated === 'boolean') {
        lines.push(`sample_truncated: ${rejection.sample_truncated}`);
    }
    if (typeof rejection.pass === 'number') lines.push(`pass: ${rejection.pass}`);
    if (typeof rejection.max_passes === 'number') lines.push(`max_passes: ${rejection.max_passes}`);
    if (rejection.path) lines.push(`path: ${rejection.path}`);
    const sampleSafetyNote = workerOutputSampleSafetyNote(rejection);
    if (sampleSafetyNote) lines.push(`sample: ${sampleSafetyNote}`);
    return lines.join('\n');
}

export function hasSafeWorkerOutputDiagnostic(rejection: WorkerOutputRejection): boolean {
    return Boolean(
        rejection.sample_reason === 'redaction_applied' ||
        rejection.sample_truncated ||
        (rejection.sample && rejection.sample.length > 0),
    );
}
