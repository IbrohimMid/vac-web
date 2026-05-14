import { create } from 'zustand';

export type TaskLifecycleStatus =
  | 'draft'
  | 'planned'
  | 'awaiting_approval'
  | 'executing'
  | 'blocked'
  | 'reviewing'
  | 'validating'
  | 'ready_to_ship'
  | 'completed'
  | 'failed';

export type TaskPlanItemStatus = 'pending' | 'active' | 'done' | 'blocked' | 'failed';

export interface TaskPlanItem {
  id: string;
  label: string;
  status: TaskPlanItemStatus;
}

export interface TaskValidationState {
  status: 'idle' | 'running' | 'passed' | 'failed';
  command?: string;
  message?: string;
  updatedAt: string;
}

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  title: string;
  status: TaskLifecycleStatus;
  plan: TaskPlanItem[];
  activeStepId: string | null;
  changedFiles: string[];
  commands: string[];
  approvalsNeeded: string[];
  validation: TaskValidationState | null;
  blocker: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TasksSlice {
  tasks: Map<string, TaskRecord>;
  order: string[];
  activeTaskId: string | null;

  upsertTask(input: {
    taskId: string;
    sessionId: string;
    title: string;
    status?: TaskLifecycleStatus;
    plan?: TaskPlanItem[];
    changedFiles?: string[];
    commands?: string[];
    approvalsNeeded?: string[];
    now?: string;
  }): void;
  updatePlan(input: { taskId: string; plan: TaskPlanItem[]; activeStepId?: string | null; now?: string }): void;
  updateStatus(input: { taskId: string; status: TaskLifecycleStatus; blocker?: string | null; errorMessage?: string | null; now?: string }): void;
  updateValidation(input: { taskId: string; status: TaskValidationState['status']; command?: string; message?: string; now?: string }): void;
  addChangedFiles(taskId: string, files: string[], now?: string): void;
  addCommand(taskId: string, command: string, now?: string): void;
  requireApproval(taskId: string, approvalId: string, now?: string): void;
  resolveApproval(taskId: string, approvalId: string, now?: string): void;
  setActiveTask(taskId: string | null): void;
  clearSession(sessionId: string): void;
  resetAll(): void;
}

function timestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)));
}

function mergeTask(existing: TaskRecord | undefined, input: Parameters<TasksSlice['upsertTask']>[0]): TaskRecord {
  const now = timestamp(input.now);
  return {
    taskId: input.taskId,
    sessionId: input.sessionId,
    title: input.title,
    status: input.status ?? existing?.status ?? 'draft',
    plan: input.plan ?? existing?.plan ?? [],
    activeStepId: existing?.activeStepId ?? null,
    changedFiles: input.changedFiles ? uniq([...(existing?.changedFiles ?? []), ...input.changedFiles]) : existing?.changedFiles ?? [],
    commands: input.commands ? uniq([...(existing?.commands ?? []), ...input.commands]) : existing?.commands ?? [],
    approvalsNeeded: input.approvalsNeeded ? uniq([...(existing?.approvalsNeeded ?? []), ...input.approvalsNeeded]) : existing?.approvalsNeeded ?? [],
    validation: existing?.validation ?? null,
    blocker: existing?.blocker ?? null,
    errorMessage: existing?.errorMessage ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export const useTasks = create<TasksSlice>((set) => ({
  tasks: new Map(),
  order: [],
  activeTaskId: null,

  upsertTask(input) {
    set((s) => {
      const tasks = new Map(s.tasks);
      const existing = tasks.get(input.taskId);
      tasks.set(input.taskId, mergeTask(existing, input));
      const order = existing ? s.order : [...s.order, input.taskId];
      return { tasks, order, activeTaskId: s.activeTaskId ?? input.taskId };
    });
  },

  updatePlan(input) {
    set((s) => {
      const cur = s.tasks.get(input.taskId);
      if (!cur) return {};
      const tasks = new Map(s.tasks);
      tasks.set(input.taskId, {
        ...cur,
        plan: input.plan,
        activeStepId: input.activeStepId === undefined ? cur.activeStepId : input.activeStepId,
        status: cur.status === 'draft' ? 'planned' : cur.status,
        updatedAt: timestamp(input.now),
      });
      return { tasks };
    });
  },

  updateStatus(input) {
    set((s) => {
      const cur = s.tasks.get(input.taskId);
      if (!cur) return {};
      const tasks = new Map(s.tasks);
      tasks.set(input.taskId, {
        ...cur,
        status: input.status,
        blocker: input.blocker === undefined ? cur.blocker : input.blocker,
        errorMessage: input.errorMessage === undefined ? cur.errorMessage : input.errorMessage,
        updatedAt: timestamp(input.now),
      });
      return { tasks };
    });
  },

  updateValidation(input) {
    set((s) => {
      const cur = s.tasks.get(input.taskId);
      if (!cur) return {};
      const now = timestamp(input.now);
      const nextValidation: TaskValidationState = {
        status: input.status,
        updatedAt: now,
        ...(input.command !== undefined && { command: input.command }),
        ...(input.message !== undefined && { message: input.message }),
      };
      const nextStatus: TaskLifecycleStatus =
        input.status === 'running' ? 'validating' : input.status === 'passed' ? 'ready_to_ship' : input.status === 'failed' ? 'failed' : cur.status;
      const tasks = new Map(s.tasks);
      tasks.set(input.taskId, { ...cur, status: nextStatus, validation: nextValidation, updatedAt: now });
      return { tasks };
    });
  },

  addChangedFiles(taskId, files, now) {
    set((s) => {
      const cur = s.tasks.get(taskId);
      if (!cur) return {};
      const tasks = new Map(s.tasks);
      tasks.set(taskId, { ...cur, changedFiles: uniq([...cur.changedFiles, ...files]), updatedAt: timestamp(now) });
      return { tasks };
    });
  },

  addCommand(taskId, command, now) {
    set((s) => {
      const cur = s.tasks.get(taskId);
      if (!cur || command.length === 0) return {};
      const tasks = new Map(s.tasks);
      tasks.set(taskId, { ...cur, commands: uniq([...cur.commands, command]), updatedAt: timestamp(now) });
      return { tasks };
    });
  },

  requireApproval(taskId, approvalId, now) {
    set((s) => {
      const cur = s.tasks.get(taskId);
      if (!cur || approvalId.length === 0) return {};
      const tasks = new Map(s.tasks);
      tasks.set(taskId, { ...cur, status: 'awaiting_approval', approvalsNeeded: uniq([...cur.approvalsNeeded, approvalId]), updatedAt: timestamp(now) });
      return { tasks };
    });
  },

  resolveApproval(taskId, approvalId, now) {
    set((s) => {
      const cur = s.tasks.get(taskId);
      if (!cur) return {};
      const remaining = cur.approvalsNeeded.filter((id) => id !== approvalId);
      const tasks = new Map(s.tasks);
      tasks.set(taskId, { ...cur, approvalsNeeded: remaining, status: remaining.length === 0 && cur.status === 'awaiting_approval' ? 'planned' : cur.status, updatedAt: timestamp(now) });
      return { tasks };
    });
  },

  setActiveTask(taskId) {
    set({ activeTaskId: taskId });
  },

  clearSession(sessionId) {
    set((s) => {
      const tasks = new Map(s.tasks);
      const removed = new Set<string>();
      for (const [id, task] of tasks) {
        if (task.sessionId === sessionId) {
          tasks.delete(id);
          removed.add(id);
        }
      }
      return {
        tasks,
        order: s.order.filter((id) => !removed.has(id)),
        activeTaskId: s.activeTaskId && removed.has(s.activeTaskId) ? null : s.activeTaskId,
      };
    });
  },

  resetAll() {
    set({ tasks: new Map(), order: [], activeTaskId: null });
  },
}));

export function selectSessionTasks(sessionId: string | null): TaskRecord[] {
  if (!sessionId) return [];
  const s = useTasks.getState();
  return s.order.map((id) => s.tasks.get(id)).filter((task): task is TaskRecord => !!task && task.sessionId === sessionId);
}

export function selectActiveTask(sessionId: string | null): TaskRecord | null {
  const tasks = selectSessionTasks(sessionId);
  const activeId = useTasks.getState().activeTaskId;
  return tasks.find((task) => task.taskId === activeId) ?? tasks[0] ?? null;
}
