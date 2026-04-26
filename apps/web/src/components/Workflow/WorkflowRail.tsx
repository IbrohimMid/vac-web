// VIL-style workflow rail — shows the current session's workflow run
// as a step list with status badges. Artifact chips navigate workbench tabs.
//
// Navigation is driven by the onSelectArtifactTarget prop (cockpit BuildSurface
// passes setTab). Falls back to useWorkbench for non-cockpit usage.

import { useWorkflow, type WorkflowStep, type WorkflowArtifact } from '../../stores/workflow';
import { useSession } from '../../stores/session';
import { useWorkbench } from '../../stores/workbench';

// Subset of WBTabId that artifacts can navigate to.
export type WorkflowArtifactTarget = 'review' | 'runtime' | 'approvals' | 'activity' | 'transcript';

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

const ARTIFACT_KIND_TARGET: Record<string, WorkflowArtifactTarget> = {
  review_diff: 'review',
  runtime_log: 'runtime',
  approval: 'approvals',
  tool_activity: 'activity',
};

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

interface ChipProps {
  artifact: WorkflowArtifact;
  onNavigate: (target: WorkflowArtifactTarget) => void;
}

function ArtifactKindChip({ artifact, onNavigate }: ChipProps) {
  const target = ARTIFACT_KIND_TARGET[artifact.kind] ?? 'transcript';
  const label = ARTIFACT_KIND_CHIPS[artifact.kind] ?? artifact.kind;
  const tooltipBits = [
    artifact.source_event_type ?? artifact.kind,
    `tool_call: ${artifact.tool_call_id}`,
    artifact.approval_id ? `approval: ${artifact.approval_id}` : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <button
      className={`workflow-artifact-chip workflow-artifact-chip--${artifact.kind}`}
      title={tooltipBits.join(' · ')}
      onClick={() => onNavigate(target)}
      style={{
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 3,
        background: 'var(--surface-2)',
        color: 'var(--text-2)',
        marginRight: 4,
        border: '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
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

interface ArtifactRowProps {
  artifact: WorkflowArtifact;
  onNavigate: (target: WorkflowArtifactTarget) => void;
}

function ArtifactRow({ artifact, onNavigate }: ArtifactRowProps) {
  const meta =
    artifact.runtime_command_preview
      ? artifact.runtime_command_preview
      : artifact.review_diff_count != null
        ? `${artifact.review_diff_count} file${artifact.review_diff_count !== 1 ? 's' : ''}`
        : artifact.tool_call_id.slice(0, 8) + '…';
  const correlation = [
    `tool_call: ${shortId(artifact.tool_call_id)}`,
    artifact.approval_id ? `approval: ${shortId(artifact.approval_id)}` : null,
    `src: ${artifact.source_event_type ?? artifact.kind}`,
  ]
    .filter((x): x is string => Boolean(x))
    .join(' · ');
  return (
    <div
      className="workflow-artifact-row"
      style={{ display: 'flex', gap: 6, padding: '2px 0 2px 16px', fontSize: 12, color: 'var(--text-2)', alignItems: 'flex-start' }}
      title={correlation}
    >
      <span style={{ marginTop: 1 }}>↳</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ArtifactKindChip artifact={artifact} onNavigate={onNavigate} />
          <code style={{ fontSize: 11, opacity: 0.7 }}>{meta}</code>
        </div>
        <div style={{ marginTop: 2, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
          {correlation}
        </div>
      </div>
    </div>
  );
}

interface Props {
  sessionId?: string;
  onSelectArtifactTarget?: (target: WorkflowArtifactTarget) => void;
}

export function WorkflowRail({ sessionId: propSessionId, onSelectArtifactTarget }: Props) {
  const sessionId = useSession((s) => propSessionId ?? s.sessionId);
  const run = useWorkflow((s) => (sessionId ? s.runs.get(sessionId) : undefined));
  const workflowId = useSession((s) => s.workflowId);
  const workflowName = useSession((s) => s.workflowName);
  // Fallback for non-cockpit surfaces that don't supply the prop.
  const globalSelect = useWorkbench((s) => s.select);
  const navigate = onSelectArtifactTarget ?? ((t) => globalSelect(t as Parameters<typeof globalSelect>[0]));

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
                  <ArtifactRow key={a.artifact_id} artifact={a} onNavigate={navigate} />
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
