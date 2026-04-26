// VIL-style workflow rail — shows the current session's workflow run
// as a step list with status badges. Read-only observer.

import { useWorkflow, type WorkflowStep, type WorkflowArtifact } from '../../stores/workflow';
import { useSession } from '../../stores/session';

const KIND_LABEL: Record<string, string> = {
  trigger: 'Start',
  prompt_agent: 'Prompt agent',
  await_approval: 'Await approval',
  observe_tool_activity: 'Observe tools',
  collect_review_diff: 'Review diff',
  collect_runtime_log: 'Runtime log',
  gate_decision: 'Gate decision',
  end: 'Complete',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--text-3)',
  started: 'var(--accent)',
  completed: 'var(--ok)',
  failed: 'var(--warn)',
};

function StepRow({ step }: { step: WorkflowStep }) {
  return (
    <div
      className="workflow-step-row"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
    >
      <span
        className="workflow-step-dot"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: STATUS_COLOR[step.status] ?? 'var(--text-3)',
          flexShrink: 0,
        }}
      />
      <span className="workflow-step-label" style={{ fontSize: 13, flex: 1 }}>
        {step.label || KIND_LABEL[step.activity_kind] || step.activity_kind}
      </span>
      <span
        className="workflow-step-status"
        style={{ fontSize: 11, color: STATUS_COLOR[step.status] ?? 'var(--text-3)' }}
      >
        {step.status}
      </span>
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: WorkflowArtifact }) {
  return (
    <div
      className="workflow-artifact-row"
      style={{ display: 'flex', gap: 6, padding: '2px 0 2px 16px', fontSize: 12, color: 'var(--text-2)' }}
    >
      <span>↳</span>
      <span>{artifact.kind === 'review_diff' ? 'Review diff' : 'Runtime log'}</span>
      <code style={{ fontSize: 11, opacity: 0.7 }}>{artifact.tool_call_id.slice(0, 8)}…</code>
    </div>
  );
}

interface Props {
  sessionId?: string;
}

export function WorkflowRail({ sessionId: propSessionId }: Props) {
  const sessionId = useSession((s) => propSessionId ?? s.sessionId);
  const run = useWorkflow((s) => (sessionId ? s.runs.get(sessionId) : undefined));

  if (!run) {
    return (
      <section aria-label="Workflow run" style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>
        No workflow run yet.
      </section>
    );
  }

  const statusColor =
    run.status === 'completed'
      ? 'var(--ok)'
      : run.status === 'failed'
        ? 'var(--warn)'
        : 'var(--accent)';

  return (
    <section aria-label="Workflow run" style={{ padding: '12px 16px' }}>
      <div
        className="workflow-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>{run.spec_name}</span>
        <span style={{ fontSize: 11, color: statusColor, marginLeft: 'auto' }}>
          {run.status}
        </span>
      </div>

      <div className="workflow-steps">
        {run.steps.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Waiting for first event…</p>
        ) : (
          run.steps.map((step) => {
            const stepArtifacts = run.artifacts.filter((a) => a.step_id === step.step_id);
            return (
              <div key={step.step_id}>
                <StepRow step={step} />
                {stepArtifacts.map((a) => (
                  <ArtifactRow key={a.artifact_id} artifact={a} />
                ))}
              </div>
            );
          })
        )}
      </div>

      {run.artifacts.length > 0 && (
        <div
          style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}
        >
          {run.artifacts.length} artifact{run.artifacts.length !== 1 ? 's' : ''}
        </div>
      )}
    </section>
  );
}
