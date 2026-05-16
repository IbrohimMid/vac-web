// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ValidationPanel } from './ValidationPanel';
import { useSession } from '../../stores/session';
import { useValidation } from '../../stores/validation';
import { useShell } from '../../stores/shell';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return { send: vi.fn().mockResolvedValue({} as never), on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

function seedRun() {
  useSession.getState().setSession('s1', 'mock', '/tmp/repo');
  useValidation.getState().upsertRun({ id: 'run1', sessionId: 's1', command: 'pnpm -F web typecheck', label: 'Typecheck', status: 'failed', startedAt: '2026-05-14T00:00:00Z', finishedAt: '2026-05-14T00:00:02Z', message: 'TS error', relatedFiles: ['src/a.ts'], sourceEventType: 'validation.run.updated' });
}

describe('<ValidationPanel/>', () => {
  beforeEach(() => {
    useSession.getState().clear();
    useValidation.getState().resetAll();
    useShell.getState().setOpen(false);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders no-session state', () => {
    render(<ValidationPanel transport={null} />);
    expect(screen.getByTestId('validation-panel-no-session')).toBeInTheDocument();
  });

  it('renders presets and empty results for a session', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    render(<ValidationPanel transport={fakeTransport()} />);
    expect(screen.getByTestId('validation-panel')).toBeInTheDocument();
    expect(screen.getByText('Typecheck')).toBeInTheDocument();
    expect(screen.getByTestId('validation-panel-empty')).toBeInTheDocument();
  });

  it('dispatches validation preset request', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    const t = fakeTransport();
    render(<ValidationPanel transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Typecheck/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.run.request', { session_id: 's1', command: 'pnpm -F web typecheck' });
  });

  it('renders selected failed run and sends failure context', () => {
    seedRun();
    const t = fakeTransport();
    render(<ValidationPanel transport={t} />);
    expect(screen.getByText('TS error')).toBeInTheDocument();
    expect(screen.getByText(/Files: src\/a.ts/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send to local AI/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.failure.send_context', { session_id: 's1', run_id: 'run1' });
  });

  it('cancel button is disabled for failed runs but enabled for queued/running', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    useValidation.getState().upsertRun({ id: 'q1', sessionId: 's1', command: 'pnpm test', label: 'Queued', status: 'queued', startedAt: '2026-05-14T00:00:00Z', relatedFiles: [] });
    render(<ValidationPanel transport={fakeTransport()} />);
    const cancelBtn = screen.getByTestId('validation-cancel') as HTMLButtonElement;
    expect(cancelBtn).not.toBeDisabled();
    fireEvent.click(cancelBtn);
    expect(useValidation.getState().runs.get('q1')?.status).toBe('cancelled');
  });

  it('send-to-local-AI button is disabled when selected run is not failed', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    useValidation.getState().upsertRun({ id: 'r1', sessionId: 's1', command: 'pnpm test', label: 'Running', status: 'running', startedAt: '2026-05-14T00:00:00Z', relatedFiles: [] });
    render(<ValidationPanel transport={fakeTransport()} />);
    expect(screen.getByTestId('validation-send-failure')).toBeDisabled();
  });

  it('reruns selected run', () => {
    seedRun();
    const t = fakeTransport();
    render(<ValidationPanel transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));
    expect(t.send).toHaveBeenCalledWith('s1', 'validation.run.request', { session_id: 's1', command: 'pnpm -F web typecheck', run_id: 'run1', related_files: ['src/a.ts'] });
  });

  it('opens runtime logs', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    render(<ValidationPanel transport={fakeTransport()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open runtime logs/i }));
    expect(useShell.getState().open).toBe(true);
  });
});
