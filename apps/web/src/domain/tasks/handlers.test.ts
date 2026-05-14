import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTaskHandlers, requestTaskContinue, requestTaskPlanChanges, requestTaskValidation } from './handlers';
import { useTasks } from '../../stores/tasks';
import type { TransportHandle } from '../../transport';

interface EventFrameLite {
  id: string;
  seq: number;
  ts: string;
  type: string;
  session_id: string;
  payload?: unknown;
}

interface MockTransport {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(type: string, payload: unknown, sessionId?: string): void;
}

function createMockTransport(): MockTransport {
  const handlers = new Map<string, Array<(ev: EventFrameLite) => void>>();
  const transport: MockTransport = {
    send: vi.fn().mockResolvedValue({} as never),
    close: vi.fn(),
    on: vi.fn().mockImplementation((type: string, h: (ev: EventFrameLite) => void) => {
      const list = handlers.get(type) ?? [];
      list.push(h);
      handlers.set(type, list);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((x) => x !== h));
    }),
    emit(type, payload, sessionId = 's1') {
      (handlers.get(type) ?? []).forEach((h) => h({ id: 'e', seq: 1, ts: '2026-05-14T00:00:00Z', type, session_id: sessionId, payload }));
    },
  };
  return transport;
}

describe('task handlers', () => {
  beforeEach(() => {
    useTasks.getState().resetAll();
  });

  it('task.plan.proposed upserts task and plan items', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.plan.proposed', { task_id: 'task1', title: 'Implement thing', plan: [{ id: 'p1', label: 'Inspect', status: 'active' }], active_step_id: 'p1' });
    const task = useTasks.getState().tasks.get('task1')!;
    expect(task.status).toBe('planned');
    expect(task.plan[0]!.label).toBe('Inspect');
    expect(task.activeStepId).toBe('p1');
  });

  it('execution events update lifecycle status', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.execution.started', { task_id: 'task1', title: 'Task' });
    expect(useTasks.getState().tasks.get('task1')!.status).toBe('executing');
    t.emit('task.execution.blocked', { task_id: 'task1', title: 'Task', blocker: 'Need approval' });
    expect(useTasks.getState().tasks.get('task1')!.blocker).toBe('Need approval');
    t.emit('task.execution.completed', { task_id: 'task1', title: 'Task' });
    expect(useTasks.getState().tasks.get('task1')!.status).toBe('completed');
  });

  it('failed event records error message', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.execution.failed', { task_id: 'task1', title: 'Task', message: 'boom' });
    const task = useTasks.getState().tasks.get('task1')!;
    expect(task.status).toBe('failed');
    expect(task.errorMessage).toBe('boom');
  });

  it('approval events add and resolve approval requirement', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.approval.required', { task_id: 'task1', title: 'Task', approval_id: 'appr1' });
    expect(useTasks.getState().tasks.get('task1')!.approvalsNeeded).toEqual(['appr1']);
    t.emit('task.approval.resolved', { task_id: 'task1', approval_id: 'appr1' });
    expect(useTasks.getState().tasks.get('task1')!.approvalsNeeded).toEqual([]);
  });

  it('validation.run.updated updates task validation state', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.plan.proposed', { task_id: 'task1', title: 'Task' });
    t.emit('validation.run.updated', { task_id: 'task1', status: 'failed', command: 'pnpm test', message: 'red' });
    const task = useTasks.getState().tasks.get('task1')!;
    expect(task.status).toBe('failed');
    expect(task.validation!.command).toBe('pnpm test');
  });

  it('ignores malformed task events', () => {
    const t = createMockTransport();
    registerTaskHandlers(t as unknown as TransportHandle);
    t.emit('task.plan.proposed', { title: 'Missing id' });
    expect(useTasks.getState().tasks.size).toBe(0);
  });

  it('cleanup unsubscribes handlers', () => {
    const t = createMockTransport();
    const off = registerTaskHandlers(t as unknown as TransportHandle);
    off();
    t.emit('task.execution.started', { task_id: 'task1', title: 'Task' });
    expect(useTasks.getState().tasks.size).toBe(0);
  });

  it('request helpers send outbound task lifecycle events', async () => {
    const t = createMockTransport();
    await requestTaskContinue(t as unknown as TransportHandle, 's1', { taskId: 'task1' });
    await requestTaskPlanChanges(t as unknown as TransportHandle, 's1', { taskId: 'task1', note: 'tighten scope' });
    await requestTaskValidation(t as unknown as TransportHandle, 's1', { taskId: 'task1' });
    expect(t.send).toHaveBeenNthCalledWith(1, 's1', 'task.execution.continue', { session_id: 's1', task_id: 'task1' });
    expect(t.send).toHaveBeenNthCalledWith(2, 's1', 'task.plan.request_changes', { session_id: 's1', task_id: 'task1', note: 'tighten scope' });
    expect(t.send).toHaveBeenNthCalledWith(3, 's1', 'validation.run.request', { session_id: 's1', task_id: 'task1' });
  });
});
