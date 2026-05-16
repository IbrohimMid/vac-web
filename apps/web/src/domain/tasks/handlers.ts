import { useTasks, type TaskLifecycleStatus, type TaskPlanItem, type TaskValidationState } from '../../stores/tasks';
import type { TransportHandle } from '../../transport';

interface TaskBasePayload {
  session_id?: string;
  task_id?: string;
  title?: string;
  status?: string;
  plan?: unknown;
  active_step_id?: string | null;
  changed_files?: unknown;
  commands?: unknown;
  approvals_needed?: unknown;
  blocker?: string | null;
  message?: string | null;
  error_message?: string | null;
  approval_id?: string;
  command?: string;
}

interface RequestOpts {
  taskId?: string | null;
  note?: string | undefined;
}

const TASK_STATUSES: TaskLifecycleStatus[] = [
  'draft',
  'planned',
  'awaiting_approval',
  'executing',
  'blocked',
  'reviewing',
  'validating',
  'ready_to_ship',
  'completed',
  'failed',
];

const VALIDATION_STATUSES: TaskValidationState['status'][] = ['idle', 'queued', 'running', 'passed', 'failed', 'cancelled'];

function isTaskStatus(raw: string | undefined): raw is TaskLifecycleStatus {
  return !!raw && TASK_STATUSES.includes(raw as TaskLifecycleStatus);
}

function isValidationStatus(raw: string | undefined): raw is TaskValidationState['status'] {
  return !!raw && VALIDATION_STATUSES.includes(raw as TaskValidationState['status']);
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

function parsePlan(raw: unknown): TaskPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskPlanItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    const rawStatus = typeof r.status === 'string' ? r.status : 'pending';
    const status: TaskPlanItem['status'] =
      rawStatus === 'active' || rawStatus === 'done' || rawStatus === 'blocked' || rawStatus === 'failed' ? rawStatus : 'pending';
    out.push({ id: r.id, label: r.label, status });
  }
  return out;
}

function payload(evPayload: unknown): TaskBasePayload {
  return (evPayload ?? {}) as TaskBasePayload;
}

function applyTaskUpsert(p: TaskBasePayload, fallbackSessionId: string): string | null {
  if (typeof p.task_id !== 'string' || p.task_id.length === 0) return null;
  useTasks.getState().upsertTask({
    taskId: p.task_id,
    sessionId: p.session_id ?? fallbackSessionId,
    title: typeof p.title === 'string' && p.title.length > 0 ? p.title : p.task_id,
    ...(isTaskStatus(p.status) ? { status: p.status } : {}),
    plan: parsePlan(p.plan),
    changedFiles: strings(p.changed_files),
    commands: strings(p.commands),
    approvalsNeeded: strings(p.approvals_needed),
  });
  return p.task_id;
}

export function registerTaskHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(transport.on('task.plan.proposed', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: p.status ?? 'planned' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updatePlan({
      taskId,
      plan: parsePlan(p.plan),
      ...(p.active_step_id !== undefined ? { activeStepId: p.active_step_id } : {}),
    });
  }));

  offs.push(transport.on('task.plan.updated', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: p.status ?? 'planned' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updatePlan({
      taskId,
      plan: parsePlan(p.plan),
      ...(p.active_step_id !== undefined ? { activeStepId: p.active_step_id } : {}),
    });
  }));

  offs.push(transport.on('task.execution.started', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: 'executing' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updateStatus({ taskId, status: 'executing', blocker: null, errorMessage: null });
  }));

  offs.push(transport.on('task.execution.blocked', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: 'blocked' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updateStatus({ taskId, status: 'blocked', blocker: p.blocker ?? p.message ?? null });
  }));

  offs.push(transport.on('task.execution.completed', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: 'completed' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updateStatus({ taskId, status: 'completed', blocker: null });
  }));

  offs.push(transport.on('task.execution.failed', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: 'failed' }, ev.session_id);
    if (!taskId) return;
    useTasks.getState().updateStatus({ taskId, status: 'failed', errorMessage: p.error_message ?? p.message ?? 'unknown error' });
  }));

  offs.push(transport.on('task.approval.required', (ev) => {
    const p = payload(ev.payload);
    const taskId = applyTaskUpsert({ ...p, status: 'awaiting_approval' }, ev.session_id);
    if (!taskId || typeof p.approval_id !== 'string') return;
    useTasks.getState().requireApproval(taskId, p.approval_id);
  }));

  offs.push(transport.on('task.approval.resolved', (ev) => {
    const p = payload(ev.payload);
    if (typeof p.task_id !== 'string' || typeof p.approval_id !== 'string') return;
    useTasks.getState().resolveApproval(p.task_id, p.approval_id);
  }));

  offs.push(transport.on('validation.run.updated', (ev) => {
    const p = payload(ev.payload);
    if (typeof p.task_id !== 'string' || !isValidationStatus(p.status)) return;
    useTasks.getState().updateValidation({
      taskId: p.task_id,
      status: p.status,
      ...(typeof p.command === 'string' ? { command: p.command } : {}),
      ...(p.message ?? p.error_message ? { message: (p.message ?? p.error_message) as string } : {}),
    });
  }));

  return () => offs.forEach((off) => off());
}

async function sendTaskEvent<P extends { session_id?: string }>(transport: TransportHandle, sessionId: string, type: string, payload: P): Promise<void> {
  await transport.send(sessionId, type, payload);
}

export async function requestTaskContinue(transport: TransportHandle, sessionId: string, opts: RequestOpts = {}): Promise<void> {
  const payload = opts.taskId ? { session_id: sessionId, task_id: opts.taskId } : { session_id: sessionId };
  await sendTaskEvent(transport, sessionId, 'task.execution.continue', payload);
}

export async function requestTaskPlanChanges(transport: TransportHandle, sessionId: string, opts: RequestOpts = {}): Promise<void> {
  const payload = {
    session_id: sessionId,
    ...(opts.taskId ? { task_id: opts.taskId } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
  await sendTaskEvent(transport, sessionId, 'task.plan.request_changes', payload);
}

export async function requestTaskValidation(transport: TransportHandle, sessionId: string, opts: RequestOpts = {}): Promise<void> {
  const payload = opts.taskId ? { session_id: sessionId, task_id: opts.taskId } : { session_id: sessionId };
  await sendTaskEvent(transport, sessionId, 'validation.run.request', payload);
}
