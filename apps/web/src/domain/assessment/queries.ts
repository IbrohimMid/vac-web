import type { AssessorFamily } from '../../stores/assessment';
import type { TransportHandle } from '../../transport';

export type AssessmentDepth = 'quick' | 'standard' | 'full';

export function requestAssessmentListRuns(
  transport: TransportHandle,
  sessionId: string,
  payload: { limit?: number; swarm?: string } = {},
) {
  return transport.send(sessionId, 'assessment.list_runs', payload);
}

export function requestAssessmentFetchReport(
  transport: TransportHandle,
  sessionId: string,
  runId: string,
) {
  return transport.send(sessionId, 'assessment.fetch_report', { run_id: runId });
}

export function requestAssessmentReplay(
  transport: TransportHandle,
  sessionId: string,
  runId: string,
) {
  return transport.send(sessionId, 'assessment.replay', { run_id: runId });
}

export function requestAssessmentDiff(
  transport: TransportHandle,
  sessionId: string,
  baseRunId: string,
  nextRunId: string,
) {
  return transport.send(sessionId, 'assessment.diff', {
    base_run_id: baseRunId,
    next_run_id: nextRunId,
  });
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
  return transport.send(sessionId, 'assessment.sweep.run', payload);
}

export function requestAssessmentSweepCancel(
  transport: TransportHandle,
  sessionId: string,
  sweepId: string,
) {
  return transport.send(sessionId, 'assessment.sweep.cancel', { sweep_id: sweepId });
}
