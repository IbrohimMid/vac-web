// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CodeWorkspace } from './CodeWorkspace';
import { useSession } from '../../stores/session';
import { useCockpit } from '../../stores/cockpit';
import { useWorkspace } from '../../stores/workspace';
import type { TransportHandle } from '../../transport';

const transport = {
  send: vi.fn(),
  close: vi.fn(),
  status: 'open',
} as unknown as TransportHandle;

describe('CodeWorkspace shell (Phase 1)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useWorkspace.setState({
      explorerCollapsed: false,
      runtimeDrawerOpen: false,
      activePanel: 'code',
    });
    useSession.getState().clear();
  });

  it('renders the three primary panes with truthful unsupported copy', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    render(<CodeWorkspace transport={transport} />);

    expect(screen.getByRole('region', { name: 'Code workspace' })).toBeInTheDocument();
    expect(
      screen.getByRole('toolbar', { name: 'Code workspace controls' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Project explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Code workspace primary')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent thread')).toBeInTheDocument();

    expect(
      screen.getByText(/bridge does not support project file browsing yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/direct browser editing is not wired yet/i),
    ).toBeInTheDocument();
  });

  it('switches center tabs between Code, Diff and Preview', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    render(<CodeWorkspace transport={transport} />);
    const codeTab = screen.getByRole('tab', { name: 'Code' });
    const diffTab = screen.getByRole('tab', { name: 'Diff' });
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    expect(codeTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(diffTab);
    expect(diffTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('code-center-diff')).toBeInTheDocument();

    fireEvent.click(previewTab);
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText(/preview context capture is not wired yet/i),
    ).toBeInTheDocument();
  });

  it('routes back to Build surface from the agent placeholder', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    useCockpit.setState({ route: 'code' });
    render(<CodeWorkspace transport={transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Build surface' }));
    expect(useCockpit.getState().route).toBe('build');
  });

  it('toggles explorer collapse via topbar control', () => {
    useSession.getState().setSession('sess-test', 'mock', '/tmp/demo');
    render(<CodeWorkspace transport={transport} />);
    const toggle = screen.getByRole('button', { name: /Hide explorer/i });
    fireEvent.click(toggle);
    expect(useWorkspace.getState().explorerCollapsed).toBe(true);
  });
});
