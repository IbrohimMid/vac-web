// VIL-style workflow store — consumes workflow.* events from bridge.
// Tracks per-session workflow runs, steps, and artifacts.

import { create } from 'zustand';

export type WorkflowRunStatus = 'running' | 'completed' | 'failed';
export type WorkflowStepStatus = 'pending' | 'started' | 'completed' | 'failed';

export interface WorkflowStep {
  step_id: string;
  activity_kind: string;
  label: string;
  status: WorkflowStepStatus;
}

export interface WorkflowArtifact {
  artifact_id: string;
  kind: string;
  step_id: string;
  tool_call_id: string;
  ts: string;
  source_event_type?: string;
  review_diff_count?: number;
  runtime_command_preview?: string;
  approval_id?: string;
}

export interface WorkflowRun {
  run_id: string;
  session_id: string;
  spec_id: string;
  spec_name: string;
  steps: WorkflowStep[];
  artifacts: WorkflowArtifact[];
  status: WorkflowRunStatus;
}

interface WorkflowSlice {
  runs: Map<string, WorkflowRun>; // key: session_id

  applyWorkflowStarted(p: {
    session_id: string;
    run_id: string;
    spec_id: string;
    spec_name: string;
  }): void;

  applyWorkflowStepStarted(p: {
    session_id: string;
    run_id: string;
    step_id: string;
    activity_kind: string;
    label: string;
  }): void;

  applyWorkflowStepUpdated(p: {
    session_id: string;
    run_id: string;
    step_id: string;
  }): void;

  applyWorkflowStepCompleted(p: {
    session_id: string;
    run_id: string;
    step_id: string;
  }): void;

  applyWorkflowStepFailed(p: {
    session_id: string;
    run_id: string;
    step_id: string;
    reason: string;
  }): void;

  applyWorkflowArtifactCreated(p: {
    session_id: string;
    run_id: string;
    artifact_id: string;
    kind: string;
    step_id: string;
    tool_call_id: string;
    ts: string;
    source_event_type?: string;
    review_diff_count?: number;
    runtime_command_preview?: string;
    approval_id?: string;
  }): void;

  applyWorkflowCompleted(p: { session_id: string; run_id: string }): void;

  applyWorkflowFailed(p: { session_id: string; run_id: string; reason: string }): void;

  clearSession(sessionId: string): void;
}

export const useWorkflow = create<WorkflowSlice>((set) => ({
  runs: new Map(),

  applyWorkflowStarted(p) {
    set((s) => {
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        run_id: p.run_id,
        session_id: p.session_id,
        spec_id: p.spec_id,
        spec_name: p.spec_name,
        steps: [],
        artifacts: [],
        status: 'running',
      });
      return { runs };
    });
  },

  applyWorkflowStepStarted(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        ...run,
        steps: [
          ...run.steps,
          {
            step_id: p.step_id,
            activity_kind: p.activity_kind,
            label: p.label,
            status: 'started',
          },
        ],
      });
      return { runs };
    });
  },

  applyWorkflowStepUpdated(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        ...run,
        steps: run.steps.map((st) =>
          st.step_id === p.step_id ? { ...st } : st,
        ),
      });
      return { runs };
    });
  },

  applyWorkflowStepCompleted(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        ...run,
        steps: run.steps.map((st) =>
          st.step_id === p.step_id ? { ...st, status: 'completed' as const } : st,
        ),
      });
      return { runs };
    });
  },

  applyWorkflowStepFailed(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        ...run,
        steps: run.steps.map((st) =>
          st.step_id === p.step_id ? { ...st, status: 'failed' as const } : st,
        ),
      });
      return { runs };
    });
  },

  applyWorkflowArtifactCreated(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, {
        ...run,
        artifacts: [
          ...run.artifacts,
          {
            artifact_id: p.artifact_id,
            kind: p.kind,
            step_id: p.step_id,
            tool_call_id: p.tool_call_id,
            ts: p.ts,
            ...(p.source_event_type !== undefined && { source_event_type: p.source_event_type }),
            ...(p.review_diff_count !== undefined && { review_diff_count: p.review_diff_count }),
            ...(p.runtime_command_preview !== undefined && { runtime_command_preview: p.runtime_command_preview }),
            ...(p.approval_id !== undefined && { approval_id: p.approval_id }),
          },
        ],
      });
      return { runs };
    });
  },

  applyWorkflowCompleted(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, { ...run, status: 'completed' });
      return { runs };
    });
  },

  applyWorkflowFailed(p) {
    set((s) => {
      const run = s.runs.get(p.session_id);
      if (!run) return {};
      const runs = new Map(s.runs);
      runs.set(p.session_id, { ...run, status: 'failed' });
      return { runs };
    });
  },

  clearSession(sessionId) {
    set((s) => {
      const runs = new Map(s.runs);
      runs.delete(sessionId);
      return { runs };
    });
  },
}));

export function selectSessionWorkflowRun(sessionId: string): WorkflowRun | null {
  return useWorkflow.getState().runs.get(sessionId) ?? null;
}
