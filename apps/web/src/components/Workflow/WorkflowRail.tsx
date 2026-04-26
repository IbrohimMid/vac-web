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

const ARTIFACT_KIND_CHIPS: Record<string, string> = {
  review_diff: 'review diff',
  runtime_log: 'runtime log',
  approval: 'approval',
  tool_activity: 'tool activity',
};

function ArtifactKindChip({ kind }: { kind: string }) {
  return (
    <span
      className={`workflow-artifact-chip workflow-artifact-chip--${kind}`}
      style={{
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 3,
        background: 'var(--surface-2)',
        color: 'var(--text-2)',
        marginRight: 4,
      }}
    >
      {ARTIFACT_KIND_CHIPS[kind] ?? kind}
    </span>
  );
}

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
      style={{ display: 'flex', gap: 6, padding: '2px 0 2px 16px', fontSize: 12, color: 'var(--text-2)', alignItems: 'center' }}
    >
      <span>↳</span>
      <ArtifactKindChip kind={artifact.kind} />
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
  const workflowId = useSession((s) => s.workflowId);
  const workflowName = useSession((s) => s.workflowName);

  if (!run) {
    return (
      <section aria-label="Workflow run" style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>
        {workflowName
          ? `Workflow: ${workflowName} — waiting for prompt`
          : workflowId
            ? `Workflow: ${workflowId} — waiting for prompt`
            : 'Waiting for prompt to start workflow'}
      </section>
    );
  }

  const statusColor =
    run.status === 'completed'
      ? 'var(--ok)'
      : run.status === 'failed'
        ? 'var(--warn)'
        : 'var(--accent)';

  const runIdShort = run.run_id.slice(-6);
  const specName = run.spec_name || workflowName || workflowId || run.spec_id;

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
        <span className="workflow-spec-name">{specName}</span>
        <code style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', marginLeft: 4 }}>
          #{runIdShort}
        </code>
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
