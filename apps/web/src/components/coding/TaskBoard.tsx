import { useMemo } from 'react';
import type { TransportHandle } from '../../transport';
import { useApprovals } from '../../stores/approvals';
import { useCockpit } from '../../stores/cockpit';
import { useReview, type ReviewActionFeedback } from '../../stores/review';
import { useRuntime } from '../../stores/runtime';
import { useToolActivity } from '../../stores/toolActivity';
import { useTasks, type TaskLifecycleStatus, type TaskRecord } from '../../stores/tasks';
import { useValidation, type ValidationRun } from '../../stores/validation';
import { requestTaskContinue, requestTaskPlanChanges, requestTaskValidation } from '../../domain/tasks/handlers';
import { countTaskStatuses, findTaskFileConflicts, summarizeAgentActivity } from '../../domain/tasks/orchestration';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
}

const STATUS_LABELS: Record<TaskLifecycleStatus, string> = {
  draft: 'draft',
  planned: 'planned',
  awaiting_approval: 'awaiting approval',
  executing: 'executing',
  blocked: 'blocked',
  reviewing: 'reviewing',
  validating: 'validating',
  ready_to_ship: 'ready to ship',
  completed: 'completed',
  failed: 'failed',
};

function formatRunDuration(run: ValidationRun): string {
  if (typeof run.durationMs === 'number') return `${Math.round(run.durationMs / 100) / 10}s`;
  if (!run.finishedAt) return '\u2014';
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '\u2014';
  return `${Math.round((end - start) / 100) / 10}s`;
}

export function TaskBoard({ sessionId, transport }: Props) {
  const taskOrder = useTasks((s) => s.order);
  const taskMap = useTasks((s) => s.tasks);
  const activeTaskId = useTasks((s) => s.activeTaskId);
  const setActiveTask = useTasks((s) => s.setActiveTask);
  const reviewFiles = useReview((s) => s.files);
  const reviewActionStatus = useReview((s) => s.actionStatus);
  const pendingApprovals = useApprovals((s) => s.pendingOrder.length);
  const runtimeJobs = useRuntime((s) => s.jobs);
  const runtimeOrder = useRuntime((s) => s.order);
  const activityOrder = useToolActivity((s) => s.activityOrder);
  const activitiesMap = useToolActivity((s) => s.activities);
  const validationRunsMap = useValidation((s) => s.runs);
  const validationRunOrder = useValidation((s) => s.order);
  const setRoute = useCockpit((s) => s.setRoute);
  const tasks = useMemo(
    () => taskOrder.map((id) => taskMap.get(id)).filter((task): task is TaskRecord => !!task && task.sessionId === sessionId),
    [taskOrder, taskMap, sessionId],
  );
  const activeTask = useMemo(() => tasks.find((task) => task.taskId === activeTaskId) ?? tasks[0] ?? null, [tasks, activeTaskId]);
  const statusCounts = useMemo(() => countTaskStatuses(tasks), [tasks]);
  const conflicts = useMemo(() => findTaskFileConflicts(tasks), [tasks]);
  const agentSummaries = useMemo(
    () => activityOrder
      .map((key) => activitiesMap.get(key))
      .filter((activity): activity is NonNullable<typeof activity> => !!activity && activity.session_id === sessionId),
    [activityOrder, activitiesMap, sessionId],
  );
  const specializedAgents = useMemo(() => summarizeAgentActivity(agentSummaries), [agentSummaries]);
  const latestRunningJob = useMemo(
    () => runtimeOrder.map((id) => runtimeJobs.get(id)).find((job) => job?.status === 'running' || job?.status === 'pending') ?? null,
    [runtimeOrder, runtimeJobs],
  );
  const taskValidationRuns = useMemo(() => {
    if (!activeTask) return [] as ValidationRun[];
    return validationRunOrder
      .map((id) => validationRunsMap.get(id))
      .filter((run): run is ValidationRun => !!run && run.sessionId === activeTask.sessionId && run.taskId === activeTask.taskId);
  }, [validationRunOrder, validationRunsMap, activeTask]);
  const ready = !!sessionId && !!transport;

  if (!sessionId) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="task-board-empty-session">
        <span className="cw-empty-title">No active coding task</span>
        <span className="cw-empty-hint">Connect a session before tracking plan, execution, review, and validation.</span>
      </div>
    );
  }

  if (!activeTask) {
    return (
      <section className="codeworkspace-taskboard" aria-label="Task lifecycle" data-testid="task-board-empty">
        <header className="codeworkspace-taskboard-header">
          <span className="cw-empty-title">Task lifecycle</span>
          <span className="codeworkspace-task-status" data-status="draft">waiting</span>
        </header>
        <div className="codeworkspace-empty" role="status">
          <span className="cw-empty-title">Waiting for task events</span>
          <span className="cw-empty-hint">Start a task in the Build surface. Task plan, execution, review, and validation state will appear here once a task is active.</span>
        </div>
      </section>
    );
  }

  const continueTask = () => {
    if (!ready || !sessionId || !transport) return;
    void requestTaskContinue(transport, sessionId, { taskId: activeTask.taskId });
  };
  const requestPlanChanges = () => {
    if (!ready || !sessionId || !transport) return;
    void requestTaskPlanChanges(transport, sessionId, { taskId: activeTask.taskId, note: 'Plan changes requested from Code Workspace.' });
  };
  const runValidation = () => {
    if (!ready || !sessionId || !transport) return;
    void requestTaskValidation(transport, sessionId, { taskId: activeTask.taskId });
  };

  return (
    <section className="codeworkspace-taskboard" aria-label="Task lifecycle" data-testid="task-board">
      <header className="codeworkspace-taskboard-header">
        <div className="codeworkspace-task-title">
          <span className="cw-empty-title">{activeTask.title}</span>
          <span className="cw-empty-hint">{activeTask.taskId}</span>
        </div>
        <span className="codeworkspace-task-status" data-status={activeTask.status}>{STATUS_LABELS[activeTask.status]}</span>
      </header>

      <OrchestrationOverview counts={statusCounts} conflicts={conflicts} latestRunningJob={latestRunningJob?.label ?? null} />

      {tasks.length > 1 ? (
        <div className="codeworkspace-task-list" aria-label="Active tasks" data-testid="task-multitask-list">
          {tasks.map((task) => (
            <button key={task.taskId} type="button" className="codeworkspace-task-chip" aria-pressed={task.taskId === activeTask.taskId} onClick={() => setActiveTask(task.taskId)}>
              <span>{task.title}</span>
              <small>{STATUS_LABELS[task.status]} {'\u00B7'} {task.changedFiles.length} files</small>
            </button>
          ))}
        </div>
      ) : null}

      <AgentActivitySummary summaries={specializedAgents} />

      <TaskSummary
        task={activeTask}
        reviewCount={reviewFiles.length}
        pendingApprovalCount={pendingApprovals}
        reviewActionStatus={reviewActionStatus}
        validationRuns={taskValidationRuns}
      />

      <div className="codeworkspace-task-actions" role="toolbar" aria-label="Task actions">
        <button type="button" className="codeworkspace-link-btn" onClick={continueTask} disabled={!ready}>Continue execution</button>
        <button type="button" className="codeworkspace-link-btn" onClick={requestPlanChanges} disabled={!ready}>Request plan changes</button>
        <button type="button" className="codeworkspace-link-btn" onClick={runValidation} disabled={!ready}>Run validation</button>
        <button type="button" className="codeworkspace-link-btn" onClick={() => setRoute('build')}>Open review</button>
        <button type="button" className="codeworkspace-link-btn" onClick={() => setRoute('build')}>Open approvals</button>
      </div>

      <p className="cw-empty-detail codeworkspace-task-truth">
        Existing approval, review, runtime, and validation surfaces remain the source of truth until task lifecycle backend support is complete.
      </p>
    </section>
  );
}


function OrchestrationOverview({ counts, conflicts, latestRunningJob }: { counts: ReturnType<typeof countTaskStatuses>; conflicts: ReturnType<typeof findTaskFileConflicts>; latestRunningJob: string | null }) {
  return (
    <div className="codeworkspace-task-orchestration" data-testid="task-orchestration">
      <div className="codeworkspace-task-orchestration-counts" aria-label="Multi-task status counts">
        <span>Active: {counts.active}</span>
        <span>Blocked: {counts.blocked}</span>
        <span>Needs review: {counts.needsReview}</span>
        <span>Done: {counts.completed}</span>
        <span>Failed: {counts.failed}</span>
      </div>
      {latestRunningJob ? <span className="cw-empty-detail">Running command: {latestRunningJob}</span> : null}
      {conflicts.length > 0 ? (
        <div className="codeworkspace-task-conflicts" role="alert" data-testid="task-conflicts">
          <strong>Conflict signals</strong>
          {conflicts.slice(0, 3).map((conflict) => (
            <span key={conflict.path}>{conflict.path} shared by {conflict.taskIds.join(', ')}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentActivitySummary({ summaries }: { summaries: ReturnType<typeof summarizeAgentActivity> }) {
  if (summaries.length === 0) {
    return (
      <div className="codeworkspace-task-agents" data-testid="task-agent-summary-empty">
        <strong>Specialized agents</strong>
        <span className="cw-empty-detail">No sub-agent tool activity observed for this session yet.</span>
      </div>
    );
  }
  return (
    <div className="codeworkspace-task-agents" data-testid="task-agent-summary">
      <strong>Specialized agents</strong>
      <div className="codeworkspace-task-agent-list">
        {summaries.slice(0, 4).map((summary) => (
          <div key={`${summary.agentId}:${summary.agentKind}`} className="codeworkspace-task-agent-card">
            <span>{summary.agentKind}</span>
            <strong>{summary.agentId}</strong>
            <small>{summary.total} tools {'\u00B7'} {summary.running} running {'\u00B7'} {summary.failed} failed</small>
            <small>{summary.latestTitle} {'\u00B7'} {summary.latestStatus}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TaskSummaryProps {
  task: TaskRecord;
  reviewCount: number;
  pendingApprovalCount: number;
  reviewActionStatus: Record<string, ReviewActionFeedback>;
  validationRuns: ValidationRun[];
}

function TaskSummary({ task, reviewCount, pendingApprovalCount, reviewActionStatus, validationRuns }: TaskSummaryProps) {
  return (
    <div className="codeworkspace-task-summary">
      <div className="codeworkspace-task-metrics" aria-label="Task metrics">
        <span>Plan: {task.plan.length}</span>
        <span>Changed files: {task.changedFiles.length || reviewCount}</span>
        <span>Commands: {task.commands.length}</span>
        <span>Approvals: {task.approvalsNeeded.length || pendingApprovalCount}</span>
      </div>

      {task.blocker ? <p className="codeworkspace-task-blocker" role="alert">Blocked: {task.blocker}</p> : null}
      {task.errorMessage ? <p className="codeworkspace-task-blocker" role="alert">Error: {task.errorMessage}</p> : null}

      {task.plan.length > 0 ? (
        <ol className="codeworkspace-task-plan" data-testid="task-plan">
          {task.plan.map((item) => (
            <li key={item.id} data-status={item.status} data-active={task.activeStepId === item.id}>
              <span>{item.label}</span>
              <span>{item.status}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="codeworkspace-empty" role="status" data-testid="task-plan-empty">
          <span className="cw-empty-title">No plan proposed yet</span>
          <span className="cw-empty-hint">Plan checklist will appear when task.plan.proposed arrives.</span>
        </div>
      )}

      <div className="codeworkspace-task-artifacts">
        <ChangedFilesList items={task.changedFiles} reviewActionStatus={reviewActionStatus} />
        <ArtifactList title="Commands" items={task.commands} empty="No commands linked yet." />
      </div>

      {task.validation ? (
        <div className="codeworkspace-task-validation" data-status={task.validation.status} data-testid="task-validation">
          <strong>Validation: {task.validation.status}</strong>
          {task.validation.command ? <span>{task.validation.command}</span> : null}
          {task.validation.message ? <span>{task.validation.message}</span> : null}
        </div>
      ) : null}

      <ValidationHistory runs={validationRuns} />
    </div>
  );
}

function ChangedFilesList({ items, reviewActionStatus }: { items: string[]; reviewActionStatus: Record<string, ReviewActionFeedback> }) {
  if (items.length === 0) {
    return (
      <div className="codeworkspace-task-artifact-list" data-testid="task-changed-files-empty">
        <strong>Changed files</strong>
        <span className="cw-empty-detail">No changed files linked yet.</span>
      </div>
    );
  }
  return (
    <div className="codeworkspace-task-artifact-list" data-testid="task-changed-files">
      <strong>Changed files</strong>
      <ul>
        {items.slice(0, 5).map((path) => {
          const feedback = reviewActionStatus[`file:${path}`];
          return (
            <li
              key={path}
              data-testid="task-changed-file"
              data-action-status={feedback?.status ?? 'idle'}
            >
              <span>{path}</span>
              {feedback && feedback.status !== 'idle' ? (
                <small className="codeworkspace-task-action-badge" data-status={feedback.status}>
                  {feedback.status}
                </small>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ValidationHistory({ runs }: { runs: ValidationRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="codeworkspace-task-validation-history" data-testid="task-validation-history-empty">
        <strong>Validation history</strong>
        <span className="cw-empty-detail">No validation runs linked to this task yet.</span>
      </div>
    );
  }
  return (
    <div className="codeworkspace-task-validation-history" data-testid="task-validation-history">
      <strong>Validation history</strong>
      <ol>
        {runs.slice(0, 5).map((run) => (
          <li
            key={run.id}
            data-testid="task-validation-history-row"
            data-status={run.status}
          >
            <span>{run.label}</span>
            <small>{run.status} {'\u00B7'} {formatRunDuration(run)}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ArtifactList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="codeworkspace-task-artifact-list">
      <strong>{title}</strong>
      {items.length > 0 ? (
        <ul>
          {items.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <span className="cw-empty-detail">{empty}</span>
      )}
    </div>
  );
}
