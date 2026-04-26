// Register workflow.* event handlers from the bridge.

import { useWorkflow } from '../../stores/workflow';
import type { TransportHandle } from '../../transport';

export function registerWorkflowHandlers(transport: TransportHandle): () => void {
  const store = useWorkflow.getState;
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('workflow.started', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['run_id'] !== 'string') return;
      store().applyWorkflowStarted({
        session_id: ev.session_id,
        run_id: p['run_id'] as string,
        spec_id: typeof p['spec_id'] === 'string' ? p['spec_id'] : '',
        spec_name: typeof p['spec_name'] === 'string' ? p['spec_name'] : '',
      });
    }),
  );

  offs.push(
    transport.on('workflow.step.started', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['step_id'] !== 'string') return;
      store().applyWorkflowStepStarted({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        step_id: p['step_id'] as string,
        activity_kind: typeof p['activity_kind'] === 'string' ? p['activity_kind'] : 'other',
        label: typeof p['label'] === 'string' ? p['label'] : '',
      });
    }),
  );

  offs.push(
    transport.on('workflow.step.updated', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['step_id'] !== 'string') return;
      store().applyWorkflowStepUpdated({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        step_id: p['step_id'] as string,
      });
    }),
  );

  offs.push(
    transport.on('workflow.step.completed', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['step_id'] !== 'string') return;
      store().applyWorkflowStepCompleted({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        step_id: p['step_id'] as string,
      });
    }),
  );

  offs.push(
    transport.on('workflow.step.failed', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['step_id'] !== 'string') return;
      store().applyWorkflowStepFailed({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        step_id: p['step_id'] as string,
        reason: typeof p['reason'] === 'string' ? p['reason'] : 'unknown',
      });
    }),
  );

  offs.push(
    transport.on('workflow.artifact.created', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || typeof p['artifact_id'] !== 'string') return;
      store().applyWorkflowArtifactCreated({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        artifact_id: p['artifact_id'] as string,
        kind: typeof p['kind'] === 'string' ? p['kind'] : 'unknown',
        step_id: typeof p['step_id'] === 'string' ? p['step_id'] : '',
        tool_call_id: typeof p['tool_call_id'] === 'string' ? p['tool_call_id'] : '',
        ts: typeof p['ts'] === 'string' ? p['ts'] : ev.ts,
        ...(typeof p['source_event_type'] === 'string' && { source_event_type: p['source_event_type'] }),
        ...(typeof p['review_diff_count'] === 'number' && { review_diff_count: p['review_diff_count'] }),
        ...(typeof p['runtime_command_preview'] === 'string' && { runtime_command_preview: p['runtime_command_preview'] }),
        ...(typeof p['approval_id'] === 'string' && { approval_id: p['approval_id'] }),
      });
    }),
  );

  offs.push(
    transport.on('workflow.completed', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p) return;
      store().applyWorkflowCompleted({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
      });
    }),
  );

  offs.push(
    transport.on('workflow.failed', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p) return;
      store().applyWorkflowFailed({
        session_id: ev.session_id,
        run_id: typeof p['run_id'] === 'string' ? p['run_id'] : '',
        reason: typeof p['reason'] === 'string' ? p['reason'] : 'unknown',
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
