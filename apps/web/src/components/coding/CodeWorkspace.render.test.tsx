// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CodeWorkspace } from './CodeWorkspace';
import { useSession } from '../../stores/session';
import { useCockpit } from '../../stores/cockpit';
import { useWorkspace } from '../../stores/workspace';
import { useProject } from '../../stores/project';
import type { TransportHandle } from '../../transport';

const transport = {
  send: vi.fn().mockResolvedValue({} as never),
  on: vi.fn().mockReturnValue(() => {}),
  close: vi.fn(),
  status: 'open',
} as unknown as TransportHandle;

describe('CodeWorkspace shell', () => {
  beforeEach(() => { useProject.getState().resetAll(); });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useWorkspace.setState({ explorerCollapsed: false, runtimeDrawerOpen: false, activePanel: 'code' });
    useSession.getState().clear();
    useProject.getState().resetAll();
  });

  it('renders the three primary panes with truthful unsupported copy', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    useProject.getState().setTreeUnsupported('no bridge support yet');
    render(<CodeWorkspace transport={transport} />);
    expect(screen.getByRole('region', { name: 'Code workspace' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Code workspace controls' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Code workspace primary')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent thread')).toBeInTheDocument();
    expect(screen.getByText(/bridge does not support project file browsing yet/i)).toBeInTheDocument();
    expect(screen.getByText(/direct browser editing is not wired yet/i)).toBeInTheDocument();
  });

  it('explorer auto-issues project.tree.request when idle with session + transport', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    render(<CodeWorkspace transport={transport} />);
    expect(transport.send).toHaveBeenCalledWith('sess-test', 'project.tree.request', {});
    expect(screen.getByTestId('code-explorer-loading')).toBeInTheDocument();
  });

  it('switches center tabs between Code, Diff and Preview', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    useProject.getState().setTreeUnsupported('no bridge support yet');
    render(<CodeWorkspace transport={transport} />);
    const diffTab = screen.getByRole('tab', { name: 'Diff' });
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const validationTab = screen.getByRole('tab', { name: 'Validation' });
    fireEvent.click(diffTab);
    expect(diffTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('review-queue-empty')).toBeInTheDocument();
    fireEvent.click(previewTab);
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
    expect(screen.getByText(/preview bridge support is not confirmed/i)).toBeInTheDocument();
    fireEvent.click(validationTab);
    expect(validationTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('validation-panel')).toBeInTheDocument();
  });

  it('routes back to Build surface from the agent placeholder', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    useProject.getState().setTreeUnsupported('no bridge support yet');
    useCockpit.setState({ route: 'code' });
    render(<CodeWorkspace transport={transport} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Build surface' })[1]!);
    expect(useCockpit.getState().route).toBe('build');
  });

  it('toggles explorer collapse via topbar control', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    useProject.getState().setTreeUnsupported('no bridge support yet');
    render(<CodeWorkspace transport={transport} />);
    const toggle = screen.getByRole('button', { name: /Hide explorer/i });
    fireEvent.click(toggle);
    expect(useWorkspace.getState().explorerCollapsed).toBe(true);
  });

  it('carries data-density attribute from cockpit store', () => {
    useCockpit.setState({ density: 'compact' });
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    render(<CodeWorkspace transport={transport} />);
    const region = screen.getByRole('region', { name: 'Code workspace' });
    expect(region).toHaveAttribute('data-density', 'compact');
    useCockpit.setState({ density: 'regular' });
  });
});
