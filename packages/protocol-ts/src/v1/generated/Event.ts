// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/event.schema.json

/**
 * Discriminated union over `type`. Narrow with `x.type === '...'`.
 */
export type Event =
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.ready';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.snapshot';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.updated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.closed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.message_added';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.delta';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.completed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.error';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.pending';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.resolved';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.expired';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'workbench.state';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'review.diff_ready';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'review.changeset_updated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'runtime.jobs_updated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'runtime.job_log';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'plan.updated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.started';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.output';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.exited';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'system_pulse.updated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'notify.event';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'overlay.opened';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'overlay.dismissed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'activity.appended';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.started';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.progress';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.candidate_received';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.candidate_rejected';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.finding_added';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.evidence_attached';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.evidence_stale_detected';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.completed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.failed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.diff_ready';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.created';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.approved';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.rejected';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.dispatched';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.execution_progress';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.completed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.invalidated';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.expired';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.state_changed';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.override_applied';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.override_revoked';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.connected';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.disconnected';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.health';
      payload: unknown;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.rate_limited';
      payload: unknown;
    }
;
