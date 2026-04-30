import {
  useAssessment,
  type AssessorFamily,
  type QueryAction,
  type QueryFailureReason,
} from '../../stores/assessment';
import type { Ack } from '../../transport';
import type { TransportHandle } from '../../transport';

export type AssessmentDepth = 'quick' | 'standard' | 'full';

/** Map a backend ack `error.code` to a stable QueryFailureReason. */
export function reasonFromAckCode(code: string | undefined): QueryFailureReason {
  switch (code) {
    case 'assessment.not_found':
      return 'not_found';
    case 'persistence.disabled':
      return 'backend_unavailable';
    case 'assessment.invalid_payload':
      return 'invalid_payload';
    case 'assessment.query_failed':
      return 'event_log_truncated';
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Human-readable label for a failure reason. UI can override for richer copy. */
export function reasonLabel(reason: QueryFailureReason): string {
  switch (reason) {
    case 'not_found':
      return 'Not found';
    case 'event_log_truncated':
      return 'Event log unavailable';
    case 'backend_unavailable':
      return 'Backend unavailable';
    case 'invalid_payload':
      return 'Invalid request';
    case 'timeout':
      return 'Request timed out';
    case 'unknown':
    default:
      return 'Request failed';
  }
}

/**
 * Send an assessment.* command and capture failure into
 * `useAssessment.queryErrors` for UI surfacing. Returns the resolved Ack so
 * callers may inspect `ok` themselves; throws only if the transport layer
 * itself rejects (in which case a `timeout` failure is recorded).
 */
async function sendCapturing(
  transport: TransportHandle,
  sessionId: string,
  type: string,
  payload: object,
  action: QueryAction,
  targetId?: string,
): Promise<Ack> {
  const store = useAssessment.getState();
  try {
    const ack: Ack = await transport.send(sessionId, type, payload);
    if (ack.ok === false) {
      const reason = reasonFromAckCode(ack.error?.code);
      store.recordQueryFailure({
        action,
        reason,
        message: ack.error?.message ?? reasonLabel(reason),
        ts: new Date().toISOString(),
        ...(targetId !== undefined ? { targetId } : {}),
      });
    } else {
      store.clearQueryFailure(action, targetId);
    }
    return ack;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Treat correlator/transport rejections as timeout (correlator currently
    // rejects with a timeout/disconnect Error). Future work could distinguish
    // disconnect vs timeout via err.name.
    store.recordQueryFailure({
      action,
      reason: 'timeout',
      message,
      ts: new Date().toISOString(),
      ...(targetId !== undefined ? { targetId } : {}),
    });
    throw err;
  }
}

export function requestAssessmentListRuns(
  transport: TransportHandle,
  sessionId: string,
  payload: { limit?: number; swarm?: string } = {},
) {
  return sendCapturing(transport, sessionId, 'assessment.list_runs', payload, 'list_runs');
}

export function requestAssessmentFetchReport(
  transport: TransportHandle,
  sessionId: string,
  runId: string,
) {
  return sendCapturing(
    transport,
    sessionId,
    'assessment.fetch_report',
    { run_id: runId },
    'fetch_report',
    runId,
  );
}

export function requestAssessmentReplay(
  transport: TransportHandle,
  sessionId: string,
  runId: string,
) {
  return sendCapturing(
    transport,
    sessionId,
    'assessment.replay',
    { run_id: runId },
    'replay',
    runId,
  );
}

export function requestAssessmentDiff(
  transport: TransportHandle,
  sessionId: string,
  baseRunId: string,
  nextRunId: string,
) {
  return sendCapturing(
    transport,
    sessionId,
    'assessment.diff',
    { base_run_id: baseRunId, next_run_id: nextRunId },
    'diff',
    `${baseRunId}\x00${nextRunId}`,
  );
}

export function requestAssessmentRun(
  transport: TransportHandle,
  sessionId: string,
  payload: {
    swarm: AssessorFamily;
    agent_id?: string;
    agent_role?: string;
  },
) {
  return sendCapturing(transport, sessionId, 'assessment.run', payload, 'run');
}

export function requestAssessmentSweepRun(
  transport: TransportHandle,
  sessionId: string,
  payload: {
    families: AssessorFamily[];
    depth: AssessmentDepth;
    agent_id?: string;
    agent_role?: string;
  },
) {
  return sendCapturing(transport, sessionId, 'assessment.sweep.run', payload, 'sweep.run');
}

export function requestAssessmentSweepCancel(
  transport: TransportHandle,
  sessionId: string,
  sweepId: string,
) {
  return sendCapturing(
    transport,
    sessionId,
    'assessment.sweep.cancel',
    { sweep_id: sweepId },
    'sweep.cancel',
    sweepId,
  );
}
