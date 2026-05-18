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
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.snapshot';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.updated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'session.closed';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.message_added';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.delta';
      payload: EventTranscriptDeltaPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.completed';
      payload: EventTranscriptCompletedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'transcript.error';
      payload: EventTranscriptErrorPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.pending';
      payload: EventApprovalPendingPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.resolved';
      payload: EventApprovalResolvedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'approval.expired';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'workbench.state';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'review.diff_ready';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'review.changeset_updated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'runtime.jobs_updated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'runtime.job_log';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'plan.updated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.started';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.output';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'shell.exited';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'system_pulse.updated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'notify.event';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'overlay.opened';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'overlay.dismissed';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'activity.appended';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.started';
      payload: EventAssessmentStartedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.progress';
      payload: EventAssessmentProgressPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.candidate_received';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.candidate_rejected';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.finding_added';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.evidence_attached';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.evidence_stale_detected';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.completed';
      payload: EventAssessmentCompletedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.failed';
      payload: EventAssessmentFailedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'assessment.diff_ready';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.created';
      payload: EventHandoffCreatedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.approved';
      payload: EventHandoffApprovedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.rejected';
      payload: EventHandoffRejectedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.dispatched';
      payload: EventHandoffDispatchedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.execution_progress';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.completed';
      payload: EventHandoffCompletedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.invalidated';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'handoff.expired';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.state_changed';
      payload: EventGateStateChangedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.override_applied';
      payload: EventGateOverrideAppliedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'gate.override_revoked';
      payload: EventGateOverrideRevokedPayload;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.connected';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.disconnected';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.health';
      payload: Record<string, unknown>;
    }
  | {
      seq: number;
      session_id: string;
      ts: string;
      v: number;
      type: 'connector.rate_limited';
      payload: Record<string, unknown>;
    }
;

export interface EventTranscriptDeltaPayload {
  message_id: string;
  delta: string;
  kind?: string;
}

export interface EventTranscriptCompletedPayload {
  message_id?: string;
}

export interface EventTranscriptErrorPayload {
  message_id?: string;
  error?: string;
  reason?: string;
}

export interface EventAssessmentStartedPayload {
  run_id: string;
}

export interface EventAssessmentProgressPayload {
  run_id: string;
}

export interface EventAssessmentCompletedPayload {
  run_id: string;
  verdict: Record<string, unknown>;
  counts?: Record<string, unknown>;
}

export interface EventAssessmentFailedPayload {
  run_id: string;
  reason?: string;
}

export interface EventApprovalPendingPayload {
  approval_id?: string;
  request_id?: string;
}

export interface EventApprovalResolvedPayload {
  approval_id?: string;
  request_id?: string;
}

export interface EventHandoffCreatedPayload {
  handoff_id?: string;
  packet?: Record<string, unknown>;
}

export interface EventHandoffApprovedPayload {
  handoff_id?: string;
  packet?: Record<string, unknown>;
}

export interface EventHandoffRejectedPayload {
  handoff_id?: string;
  packet?: Record<string, unknown>;
}

export interface EventHandoffDispatchedPayload {
  handoff_id?: string;
  packet?: Record<string, unknown>;
}

export interface EventHandoffCompletedPayload {
  handoff_id?: string;
  packet?: Record<string, unknown>;
}

export interface EventGateStateChangedPayload {
  gate_id?: string;
  state?: string;
}

export interface EventGateOverrideAppliedPayload {
  gate_id?: string;
  state?: string;
}

export interface EventGateOverrideRevokedPayload {
  gate_id?: string;
  state?: string;
}
