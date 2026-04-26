import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflow, selectSessionWorkflowRun } from './workflow';

function reset() {
  useWorkflow.setState({ runs: new Map() });
}

const BASE = {
  session_id: 'sess1',
  run_id: 'run_01',
  spec_id: 'build.basic',
  spec_name: 'Basic Build',
};

describe('workflow store', () => {
  beforeEach(reset);

  it('starts empty', () => {
    expect(useWorkflow.getState().runs.size).toBe(0);
  });

  it('applyWorkflowStarted creates run', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    const run = selectSessionWorkflowRun('sess1');
    expect(run).not.toBeNull();
    expect(run!.run_id).toBe('run_01');
    expect(run!.status).toBe('running');
    expect(run!.steps).toHaveLength(0);
  });

  it('applyWorkflowStepStarted adds step', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1',
      run_id: 'run_01',
      step_id: 'step_1',
      activity_kind: 'prompt_agent',
      label: 'Prompt agent',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]?.status).toBe('started');
    expect(run.steps[0]?.activity_kind).toBe('prompt_agent');
  });

  it('applyWorkflowStepCompleted marks step completed', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'prompt_agent', label: 'Prompt agent',
    });
    useWorkflow.getState().applyWorkflowStepCompleted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.steps[0]?.status).toBe('completed');
  });

  it('applyWorkflowStepFailed marks step failed', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'await_approval', label: 'Await approval',
    });
    useWorkflow.getState().applyWorkflowStepFailed({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1', reason: 'rejected',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.steps[0]?.status).toBe('failed');
  });

  it('applyWorkflowArtifactCreated adds artifact', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowArtifactCreated({
      session_id: 'sess1', run_id: 'run_01',
      artifact_id: 'art_01', kind: 'review_diff',
      step_id: 'step_2', tool_call_id: 'tc1',
      ts: '2026-01-01T00:00:00Z',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.artifacts).toHaveLength(1);
    expect(run.artifacts[0]?.kind).toBe('review_diff');
  });

  it('applyWorkflowArtifactCreated preserves source_event_type', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowArtifactCreated({
      session_id: 'sess1', run_id: 'run_01',
      artifact_id: 'art_02', kind: 'review_diff',
      step_id: 'step_2', tool_call_id: 'tc2',
      ts: '2026-01-01T00:00:00Z',
      source_event_type: 'review.changeset_updated',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.artifacts[0]?.source_event_type).toBe('review.changeset_updated');
  });

  it('applyWorkflowCompleted sets status completed', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowCompleted({ session_id: 'sess1', run_id: 'run_01' });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.status).toBe('completed');
  });

  it('applyWorkflowFailed sets status failed', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowFailed({ session_id: 'sess1', run_id: 'run_01', reason: 'crash' });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.status).toBe('failed');
  });

  it('clearSession removes run', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().clearSession('sess1');
    expect(selectSessionWorkflowRun('sess1')).toBeNull();
  });

  it('step updated does not change step status', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'observe_tool_activity', label: 'Observe',
    });
    useWorkflow.getState().applyWorkflowStepUpdated({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.steps[0]?.status).toBe('started');
  });

  it('selectSessionWorkflowRun returns null for unknown session', () => {
    expect(selectSessionWorkflowRun('unknown')).toBeNull();
  });

  it('events from other sessions do not pollute', () => {
    useWorkflow.getState().applyWorkflowStarted({ ...BASE, session_id: 'other' });
    expect(selectSessionWorkflowRun('sess1')).toBeNull();
    expect(selectSessionWorkflowRun('other')).not.toBeNull();
  });

  it('second workflow.started replaces current run with new run_id', () => {
    useWorkflow.getState().applyWorkflowStarted(BASE);
    useWorkflow.getState().applyWorkflowCompleted({ session_id: 'sess1', run_id: 'run_01' });
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'sess1',
      run_id: 'run_02',
      spec_id: 'build.basic',
      spec_name: 'Basic Build',
    });
    const run = selectSessionWorkflowRun('sess1')!;
    expect(run.run_id).toBe('run_02');
    expect(run.status).toBe('running');
    expect(run.steps).toHaveLength(0);
  });
});
