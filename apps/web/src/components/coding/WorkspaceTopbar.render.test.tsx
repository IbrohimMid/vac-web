// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkspaceTopbar } from './WorkspaceTopbar';
import { useSession } from '../../stores/session';
import { useWorkspace } from '../../stores/workspace';
import type { TransportHandle } from '../../transport';

const transport = {
  send: vi.fn().mockResolvedValue({} as never),
  on: vi.fn().mockReturnValue(() => {}),
  close: vi.fn(),
  status: 'open',
} as unknown as TransportHandle;

describe('WorkspaceTopbar', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.getState().clear();
    useWorkspace.getState().setBranchName(null);
  });

  it('renders the toolbar region', () => {
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByRole('toolbar', { name: 'Code workspace controls' })).toBeInTheDocument();
  });

  it('shows "No session" when no session is connected', () => {
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByText(/No session/i)).toBeInTheDocument();
  });

  it('shows session id when session is active', () => {
    useSession.getState().setSession('sess-abc-123', 'mock', '/tmp/proj');
    render(<WorkspaceTopbar transport={transport} />);
    expect(screen.getByText(/sess-abc-123/i)).toBeInTheDocument();
  });

  it('task pill has "No active task yet" title when no task exists', () => {
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByTitle('No active task yet')).toBeInTheDocument();
  });

  it('branch pill has updated title without stale phase copy', () => {
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByTitle('Branch not yet available from bridge')).toBeInTheDocument();
  });

  it('shows branch name when branch event updated the workspace store', () => {
    useWorkspace.getState().setBranchName('main');
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByTitle('Branch: main')).toBeInTheDocument();
  });

  it('palette button is disabled when transport is null', () => {
    render(<WorkspaceTopbar transport={null} />);
    expect(screen.getByTitle('Command palette (Cmd/Ctrl+K)')).toBeDisabled();
  });

  it('palette button is enabled when transport is available', () => {
    render(<WorkspaceTopbar transport={transport} />);
    expect(screen.getByTitle('Command palette (Cmd/Ctrl+K)')).toBeEnabled();
  });
});
