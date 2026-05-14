// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectExplorer } from './ProjectExplorer';
import { useProject } from '../../stores/project';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return {
    send: vi.fn().mockResolvedValue({} as never),
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as TransportHandle;
}

describe('<ProjectExplorer/>', () => {
  beforeEach(() => { useProject.getState().resetAll(); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders empty state when no session', () => {
    render(<ProjectExplorer sessionId={null} transport={null} />);
    expect(screen.getByTestId('code-explorer-empty')).toBeInTheDocument();
  });

  it('renders unsupported when session set but transport missing', () => {
    render(<ProjectExplorer sessionId="s1" transport={null} />);
    expect(screen.getByTestId('code-explorer-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/bridge does not support project file browsing yet/i)).toBeInTheDocument();
  });

  it('auto-emits project.tree.request and shows loading when idle', () => {
    const t = fakeTransport();
    render(<ProjectExplorer sessionId="s1" transport={t} />);
    expect(t.send).toHaveBeenCalledWith('s1', 'project.tree.request', {});
    expect(screen.getByTestId('code-explorer-loading')).toBeInTheDocument();
  });

  it('renders tree entries when loaded', () => {
    useProject.getState().setTreeLoaded([
      { path: 'src/index.ts', type: 'file', size: 100 },
      { path: 'src', type: 'directory' },
    ]);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-tree')).toBeInTheDocument();
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
  });

  it('renders empty-tree state for zero entries', () => {
    useProject.getState().setTreeLoaded([]);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-empty-tree')).toBeInTheDocument();
  });

  it('renders error state with retry button', () => {
    useProject.getState().setTreeError('timeout');
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('renders truthful unsupported copy when status is unsupported', () => {
    useProject.getState().setTreeUnsupported('no bridge support');
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/bridge does not support project file browsing yet/i)).toBeInTheDocument();
  });
});
