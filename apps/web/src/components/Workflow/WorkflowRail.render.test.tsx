// @vitest-environment happy-dom
// DOM render tests for WorkflowRail.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useWorkflow } from '../../stores/workflow';
import { useSession } from '../../stores/session';
import { WorkflowRail } from './WorkflowRail';

function resetStores() {
  useWorkflow.setState({ runs: new Map() });
  useSession.setState({ sessionId: 'sess1', workflowId: null, workflowName: null });
}

function seedRun() {
  useWorkflow.getState().applyWorkflowStarted({
    session_id: 'sess1',
    run_id: 'run_01',
    spec_id: 'build.basic',
    spec_name: 'Basic Build Workflow',
  });
}

describe('WorkflowRail DOM rendering', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('renders empty state when no run exists', () => {
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Waiting for prompt to start workflow')).toBeInTheDocument();
  });

  it('renders workflow name when run exists', () => {
    seedRun();
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Basic Build Workflow')).toBeInTheDocument();
  });

  it('shows running status', () => {
    seedRun();
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('shows completed status after workflow completes', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowCompleted({ session_id: 'sess1', run_id: 'run_01' });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows failed status after workflow fails', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowFailed({ session_id: 'sess1', run_id: 'run_01', reason: 'crash' });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders step with label', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'prompt_agent', label: 'Prompt agent',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Prompt agent')).toBeInTheDocument();
  });

  it('renders step status', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'prompt_agent', label: 'Prompt agent',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('started')).toBeInTheDocument();
  });

  it('renders completed step status', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'prompt_agent', label: 'Prompt agent',
    });
    useWorkflow.getState().applyWorkflowStepCompleted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders artifact count', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_2',
      activity_kind: 'collect_review_diff', label: 'Collect diff',
    });
    useWorkflow.getState().applyWorkflowArtifactCreated({
      session_id: 'sess1', run_id: 'run_01',
      artifact_id: 'art_01', kind: 'review_diff',
      step_id: 'step_2', tool_call_id: 'tc1',
      ts: '2026-01-01T00:00:00Z',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('1 artifact')).toBeInTheDocument();
  });

  it('has aria-label "Workflow run"', () => {
    seedRun();
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByRole('region', { name: 'Workflow run' })).toBeInTheDocument();
  });

  it('does not render another session run', () => {
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'other', run_id: 'run_X', spec_id: 'build.basic', spec_name: 'Other Workflow',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Waiting for prompt to start workflow')).toBeInTheDocument();
    expect(screen.queryByText('Other Workflow')).not.toBeInTheDocument();
  });

  it('renders multiple steps', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_1',
      activity_kind: 'prompt_agent', label: 'Prompt agent',
    });
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_2',
      activity_kind: 'observe_tool_activity', label: 'Observe tools',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Prompt agent')).toBeInTheDocument();
    expect(screen.getByText('Observe tools')).toBeInTheDocument();
  });

  it('shows waiting message when run exists but no steps yet', () => {
    seedRun();
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Waiting for first event…')).toBeInTheDocument();
  });

  it('shows new run after workflow replaced', () => {
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'sess1', run_id: 'run_01', spec_id: 'build.basic', spec_name: 'First Run',
    });
    useWorkflow.getState().applyWorkflowCompleted({ session_id: 'sess1', run_id: 'run_01' });
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'sess1', run_id: 'run_02', spec_id: 'build.basic', spec_name: 'Second Run',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Second Run')).toBeInTheDocument();
    expect(screen.queryByText('First Run')).not.toBeInTheDocument();
  });

  it('shows spec_name in rail header', () => {
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'sess1',
      run_id: 'run_01',
      spec_id: 'build.observe-tools',
      spec_name: 'Observe Tools Build',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Observe Tools Build')).toBeInTheDocument();
  });

  it('renders artifact kind chip for review_diff', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_2',
      activity_kind: 'collect_review_diff', label: 'Collect diff',
    });
    useWorkflow.getState().applyWorkflowArtifactCreated({
      session_id: 'sess1', run_id: 'run_01',
      artifact_id: 'art_01', kind: 'review_diff',
      step_id: 'step_2', tool_call_id: 'tc_review_001',
      ts: '2026-01-01T00:00:00Z',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('review diff')).toBeInTheDocument();
  });

  it('renders artifact kind chip for runtime_log', () => {
    seedRun();
    useWorkflow.getState().applyWorkflowStepStarted({
      session_id: 'sess1', run_id: 'run_01', step_id: 'step_3',
      activity_kind: 'collect_runtime_log', label: 'Collect runtime',
    });
    useWorkflow.getState().applyWorkflowArtifactCreated({
      session_id: 'sess1', run_id: 'run_01',
      artifact_id: 'art_02', kind: 'runtime_log',
      step_id: 'step_3', tool_call_id: 'tc_runtime_001',
      ts: '2026-01-01T00:00:00Z',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('runtime log')).toBeInTheDocument();
  });

  it('shows run_id last 6 chars compactly', () => {
    useWorkflow.getState().applyWorkflowStarted({
      session_id: 'sess1',
      run_id: 'run_ABCDEF123456',
      spec_id: 'build.basic',
      spec_name: 'Basic Build Workflow',
    });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('#123456')).toBeInTheDocument();
  });

  it('empty state text is "Waiting for prompt to start workflow"', () => {
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Waiting for prompt to start workflow')).toBeInTheDocument();
  });

  it('empty state shows workflow name before run starts', () => {
    useSession.setState({ workflowId: 'build.observe-tools', workflowName: 'Observe Tools Build' });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Workflow: Observe Tools Build — waiting for prompt')).toBeInTheDocument();
  });

  it('empty state shows workflow id when name absent', () => {
    useSession.setState({ workflowId: 'build.basic', workflowName: null });
    render(<WorkflowRail sessionId="sess1" />);
    expect(screen.getByText('Workflow: build.basic — waiting for prompt')).toBeInTheDocument();
  });
});
