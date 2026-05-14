import { beforeEach, describe, expect, it } from 'vitest';
import { selectActiveTask, selectSessionTasks, useTasks } from './tasks';

describe('useTasks', () => {
  beforeEach(() => {
    useTasks.getState().resetAll();
  });

  it('upsertTask creates a draft task and marks it active', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Build preview' });
    const task = useTasks.getState().tasks.get('t1')!;
    expect(task.status).toBe('draft');
    expect(task.title).toBe('Build preview');
    expect(useTasks.getState().activeTaskId).toBe('t1');
  });

  it('upsertTask updates existing task without duplicating order', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Old' });
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'New', status: 'executing' });
    expect(useTasks.getState().order).toEqual(['t1']);
    expect(useTasks.getState().tasks.get('t1')!.title).toBe('New');
    expect(useTasks.getState().tasks.get('t1')!.status).toBe('executing');
  });

  it('updatePlan stores checklist and promotes draft to planned', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Task' });
    useTasks.getState().updatePlan({ taskId: 't1', activeStepId: 'p1', plan: [{ id: 'p1', label: 'Inspect', status: 'active' }] });
    const task = useTasks.getState().tasks.get('t1')!;
    expect(task.status).toBe('planned');
    expect(task.activeStepId).toBe('p1');
    expect(task.plan[0]!.label).toBe('Inspect');
  });

  it('updateStatus records blockers and errors', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Task' });
    useTasks.getState().updateStatus({ taskId: 't1', status: 'blocked', blocker: 'Needs approval' });
    expect(useTasks.getState().tasks.get('t1')!.blocker).toBe('Needs approval');
    useTasks.getState().updateStatus({ taskId: 't1', status: 'failed', errorMessage: 'Tests failed' });
    expect(useTasks.getState().tasks.get('t1')!.errorMessage).toBe('Tests failed');
  });

  it('updateValidation maps running/passed/failed to lifecycle status', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Task' });
    useTasks.getState().updateValidation({ taskId: 't1', status: 'running', command: 'pnpm test' });
    expect(useTasks.getState().tasks.get('t1')!.status).toBe('validating');
    useTasks.getState().updateValidation({ taskId: 't1', status: 'passed' });
    expect(useTasks.getState().tasks.get('t1')!.status).toBe('ready_to_ship');
    useTasks.getState().updateValidation({ taskId: 't1', status: 'failed', message: 'red' });
    const task = useTasks.getState().tasks.get('t1')!;
    expect(task.status).toBe('failed');
    expect(task.validation!.message).toBe('red');
  });

  it('deduplicates changed files and commands', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Task', changedFiles: ['a.ts'] });
    useTasks.getState().addChangedFiles('t1', ['a.ts', 'b.ts']);
    useTasks.getState().addCommand('t1', 'pnpm test');
    useTasks.getState().addCommand('t1', 'pnpm test');
    const task = useTasks.getState().tasks.get('t1')!;
    expect(task.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(task.commands).toEqual(['pnpm test']);
  });

  it('requireApproval moves task to awaiting approval and resolveApproval returns to planned', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'Task', status: 'executing' });
    useTasks.getState().requireApproval('t1', 'appr1');
    expect(useTasks.getState().tasks.get('t1')!.status).toBe('awaiting_approval');
    expect(useTasks.getState().tasks.get('t1')!.approvalsNeeded).toEqual(['appr1']);
    useTasks.getState().resolveApproval('t1', 'appr1');
    const task = useTasks.getState().tasks.get('t1')!;
    expect(task.status).toBe('planned');
    expect(task.approvalsNeeded).toEqual([]);
  });

  it('selectSessionTasks filters by session order', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'One' });
    useTasks.getState().upsertTask({ taskId: 't2', sessionId: 's2', title: 'Two' });
    useTasks.getState().upsertTask({ taskId: 't3', sessionId: 's1', title: 'Three' });
    expect(selectSessionTasks('s1').map((t) => t.taskId)).toEqual(['t1', 't3']);
  });

  it('selectActiveTask returns active task or first session task', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'One' });
    useTasks.getState().upsertTask({ taskId: 't2', sessionId: 's1', title: 'Two' });
    useTasks.getState().setActiveTask('t2');
    expect(selectActiveTask('s1')!.taskId).toBe('t2');
    useTasks.getState().setActiveTask('missing');
    expect(selectActiveTask('s1')!.taskId).toBe('t1');
  });

  it('clearSession removes only that session and clears active when removed', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'One' });
    useTasks.getState().upsertTask({ taskId: 't2', sessionId: 's2', title: 'Two' });
    useTasks.getState().setActiveTask('t1');
    useTasks.getState().clearSession('s1');
    expect(useTasks.getState().tasks.has('t1')).toBe(false);
    expect(useTasks.getState().tasks.has('t2')).toBe(true);
    expect(useTasks.getState().activeTaskId).toBeNull();
  });

  it('resetAll clears every task', () => {
    useTasks.getState().upsertTask({ taskId: 't1', sessionId: 's1', title: 'One' });
    useTasks.getState().resetAll();
    expect(useTasks.getState().order).toEqual([]);
    expect(useTasks.getState().tasks.size).toBe(0);
  });
});
