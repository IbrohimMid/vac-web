import type { TaskRecord, TaskLifecycleStatus } from '../../stores/tasks';
import type { ToolActivity } from '../../stores/toolActivity';

export interface TaskConflict {
  path: string;
  taskIds: string[];
}

export interface TaskStatusCounts {
  active: number;
  blocked: number;
  needsReview: number;
  completed: number;
  failed: number;
}

export interface AgentActivitySummary {
  agentId: string;
  agentKind: string;
  total: number;
  failed: number;
  running: number;
  latestTitle: string;
  latestStatus: string;
}

const ACTIVE_STATUSES: TaskLifecycleStatus[] = ['draft', 'planned', 'awaiting_approval', 'executing', 'reviewing', 'validating', 'ready_to_ship'];

export function countTaskStatuses(tasks: TaskRecord[]): TaskStatusCounts {
  return tasks.reduce<TaskStatusCounts>(
    (acc, task) => {
      if (ACTIVE_STATUSES.includes(task.status)) acc.active += 1;
      if (task.status === 'blocked' || task.approvalsNeeded.length > 0) acc.blocked += 1;
      if (task.status === 'reviewing' || task.changedFiles.length > 0) acc.needsReview += 1;
      if (task.status === 'completed') acc.completed += 1;
      if (task.status === 'failed') acc.failed += 1;
      return acc;
    },
    { active: 0, blocked: 0, needsReview: 0, completed: 0, failed: 0 },
  );
}

export function findTaskFileConflicts(tasks: TaskRecord[]): TaskConflict[] {
  const owners = new Map<string, Set<string>>();
  for (const task of tasks) {
    for (const path of task.changedFiles) {
      const set = owners.get(path) ?? new Set<string>();
      set.add(task.taskId);
      owners.set(path, set);
    }
  }
  return [...owners.entries()]
    .filter(([, taskIds]) => taskIds.size > 1)
    .map(([path, taskIds]) => ({ path, taskIds: [...taskIds].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeAgentActivity(activities: ToolActivity[]): AgentActivitySummary[] {
  const grouped = new Map<string, AgentActivitySummary & { latestTs: string }>();
  for (const activity of activities) {
    const agentId = activity.agent_id || 'unknown-agent';
    const agentKind = activity.agent_kind || 'agent';
    const key = `${agentId}\u0000${agentKind}`;
    const current = grouped.get(key) ?? {
      agentId,
      agentKind,
      total: 0,
      failed: 0,
      running: 0,
      latestTitle: 'No tool title',
      latestStatus: 'pending',
      latestTs: '',
    };
    current.total += 1;
    if (activity.status === 'failed') current.failed += 1;
    if (activity.status === 'pending' || activity.status === 'in_progress') current.running += 1;
    if (!current.latestTs || activity.ts >= current.latestTs) {
      current.latestTs = activity.ts;
      current.latestTitle = activity.title ?? activity.kind;
      current.latestStatus = activity.status;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.latestTs.localeCompare(a.latestTs))
    .map(({ latestTs: _latestTs, ...summary }) => summary);
}
