// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskBoard } from './TaskBoard';
import { useApprovals } from '../../stores/approvals';
import { useCockpit } from '../../stores/cockpit';
import { useReview } from '../../stores/review';
import { useTasks } from '../../stores/tasks';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return { send: vi.fn().mockResolvedValue({} as never), on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

function seedTask() {
  useTasks.getState().upsertTask({ taskId: 'task1', sessionId: 's1', title: 'Implement preview', status: 'executing' });
  useTasks.getState().updatePlan({ taskId: 'task1', activeStepId: 'p1', plan: [{ id: 'p1', label: 'Inspect files', status: 'active' }, { id: 'p2', label: 'Run tests', status: 'pending' }] });
  useTasks.getState().addChangedFiles('task1', ['apps/web/src/main.tsx']);
  useTasks.getState().addCommand('task1', 'pnpm -F web typecheck');
}

describe('<TaskBoard/>', () => {
  beforeEach(() => {
    useTasks.getState().resetAll();
    useReview.getState().clear();
    useApprovals.getState().clear();
    useCockpit.setState({ route: 'code' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders no-session empty state', () => {
    render(<TaskBoard sessionId={null} transport={null} />);
    expect(screen.getByTestId('task-board-empty-session')).toBeInTheDocument();
  });

  it('renders waiting state when session has no task events', () => {
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('task-board-empty')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for task events/i)).toBeInTheDocument();
  });

  it('renders active task title, status, plan, files, and commands', () => {
    seedTask();
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
    expect(screen.getByText('Implement preview')).toBeInTheDocument();
    expect(screen.getByText('executing')).toBeInTheDocument();
    expect(screen.getByText('Inspect files')).toBeInTheDocument();
    expect(screen.getByText('apps/web/src/main.tsx')).toBeInTheDocument();
    expect(screen.getByText('pnpm -F web typecheck')).toBeInTheDocument();
  });

  it('renders validation state', () => {
    seedTask();
    useTasks.getState().updateValidation({ taskId: 'task1', status: 'failed', command: 'pnpm test', message: 'red' });
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('task-validation')).toHaveTextContent('Validation: failed');
    expect(screen.getByText('red')).toBeInTheDocument();
  });

  it('renders blocker and error messages', () => {
    seedTask();
    useTasks.getState().updateStatus({ taskId: 'task1', status: 'blocked', blocker: 'Need approval' });
    useTasks.getState().updateStatus({ taskId: 'task1', status: 'failed', errorMessage: 'boom' });
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByText(/Blocked: Need approval/i)).toBeInTheDocument();
    expect(screen.getByText(/Error: boom/i)).toBeInTheDocument();
  });

  it('switches between multiple tasks', () => {
    seedTask();
    useTasks.getState().upsertTask({ taskId: 'task2', sessionId: 's1', title: 'Second task', status: 'blocked' });
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Second task' }));
    expect(screen.getAllByText('Second task').length).toBeGreaterThan(0);
    expect(useTasks.getState().activeTaskId).toBe('task2');
  });

  it('toolbar dispatches task lifecycle requests', () => {
    seedTask();
    const t = fakeTransport();
    render(<TaskBoard sessionId="s1" transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue execution/i }));
    fireEvent.click(screen.getByRole('button', { name: /Request plan changes/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run validation/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'task.execution.continue', { session_id: 's1', task_id: 'task1' });
    expect(t.send).toHaveBeenCalledWith('s1', 'task.plan.request_changes', expect.objectContaining({ session_id: 's1', task_id: 'task1' }));
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.run.request', { session_id: 's1', task_id: 'task1' });
  });

  it('open review and approvals route to Build surface', () => {
    seedTask();
    render(<TaskBoard sessionId="s1" transport={fakeTransport()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open review/i }));
    expect(useCockpit.getState().route).toBe('build');
  });

  it('disables outbound lifecycle buttons when transport is missing', () => {
    seedTask();
    render(<TaskBoard sessionId="s1" transport={null} />);
    expect(screen.getByRole('button', { name: /Continue execution/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Run validation/i })).toBeDisabled();
  });
});
