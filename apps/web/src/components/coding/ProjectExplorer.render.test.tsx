// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  ProjectExplorer,
  buildProjectTree,
  filterProjectTree,
} from './ProjectExplorer';
import { useProject } from '../../stores/project';
import { useReview } from '../../stores/review';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return {
    send: vi.fn().mockResolvedValue({} as never),
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as TransportHandle;
}

describe('<ProjectExplorer/>', () => {
  beforeEach(() => {
    useProject.getState().resetAll();
    useReview.getState().clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

  it('renders tree entries when loaded (hierarchy + expand)', () => {
    useProject.getState().setTreeLoaded([
      { path: 'src/index.ts', type: 'file', size: 100 },
    ]);
    useProject.getState().setExpanded('src', true);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-tree')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
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

  it('clicking a file entry selects it and emits project.file.request', () => {
    useProject.getState().setTreeLoaded([{ path: 'src/index.ts', type: 'file' }]);
    useProject.getState().setExpanded('src', true);
    const t = fakeTransport();
    render(<ProjectExplorer sessionId="s1" transport={t} />);
    fireEvent.click(screen.getByText('index.ts'));
    expect(useProject.getState().selectedFilePath).toBe('src/index.ts');
    expect(t.send).toHaveBeenCalledWith('s1', 'project.file.request', { path: 'src/index.ts' });
  });

  it('clicking a directory toggles expand and does not request a file', () => {
    useProject.getState().setTreeLoaded([{ path: 'src/index.ts', type: 'file' }]);
    const t = fakeTransport();
    render(<ProjectExplorer sessionId="s1" transport={t} />);
    fireEvent.click(screen.getByText('src'));
    expect(useProject.getState().selectedFilePath).toBeNull();
    expect(useProject.getState().expanded['src']).toBe(true);
    expect(t.send).not.toHaveBeenCalledWith('s1', 'project.file.request', expect.anything());
  });

  it('renders changed badge when path is in review files', () => {
    useReview.getState().setFiles([{ path: 'src/index.ts', status: 'modified', additions: 1, deletions: 0 }]);
    useProject.getState().setTreeLoaded([{ path: 'src/index.ts', type: 'file' }]);
    useProject.getState().setExpanded('src', true);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-changed')).toBeInTheDocument();
  });

  // ---- Phase 3 additions ----

  it('renders filter input + show-hidden toggle + refresh button when loaded', () => {
    useProject.getState().setTreeLoaded([{ path: 'a.ts', type: 'file' }]);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-filter')).toBeInTheDocument();
    expect(screen.getByTestId('code-explorer-include-hidden')).toBeInTheDocument();
    expect(screen.getByTestId('code-explorer-refresh')).toBeInTheDocument();
  });

  it('filter narrows visible entries and auto-expands ancestors', () => {
    useProject.getState().setTreeLoaded([
      { path: 'src/util.ts', type: 'file' },
      { path: 'src/other.ts', type: 'file' },
      { path: 'docs/readme.md', type: 'file' },
    ]);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    const input = screen.getByTestId('code-explorer-filter') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'util' } });
    expect(useProject.getState().filter).toBe('util');
    expect(screen.getByText('util.ts')).toBeInTheDocument();
    expect(screen.queryByText('other.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('readme.md')).not.toBeInTheDocument();
  });

  it('filter with no matches renders no-matches state', () => {
    useProject.getState().setTreeLoaded([{ path: 'src/util.ts', type: 'file' }]);
    useProject.getState().setFilter('zzznomatch');
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-explorer-no-matches')).toBeInTheDocument();
  });

  it('renders truncated banner with entry count and reason', () => {
    useProject.getState().setTreeLoaded(
      [{ path: 'a.ts', type: 'file' }],
      { truncated: true, entryCount: 500, capReason: 'max_entries' },
    );
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    const banner = screen.getByTestId('code-explorer-truncated');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('500');
    expect(banner).toHaveTextContent('max_entries');
  });

  it('refresh button re-emits project.tree.request', () => {
    useProject.getState().setTreeLoaded([{ path: 'a.ts', type: 'file' }]);
    const t = fakeTransport();
    render(<ProjectExplorer sessionId="s1" transport={t} />);
    (t.send as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId('code-explorer-refresh'));
    expect(t.send).toHaveBeenCalledWith('s1', 'project.tree.request', {});
  });

  it('toggling show-hidden updates treeOptions and refetches with include_hidden:true', () => {
    useProject.getState().setTreeLoaded([{ path: 'a.ts', type: 'file' }]);
    const t = fakeTransport();
    render(<ProjectExplorer sessionId="s1" transport={t} />);
    (t.send as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId('code-explorer-include-hidden'));
    expect(useProject.getState().treeOptions.includeHidden).toBe(true);
    expect(t.send).toHaveBeenCalledWith('s1', 'project.tree.request', { include_hidden: true });
  });

  it('toggling a directory caret expands/collapses its subtree', () => {
    useProject.getState().setTreeLoaded([{ path: 'src/index.ts', type: 'file' }]);
    render(<ProjectExplorer sessionId="s1" transport={fakeTransport()} />);
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });
});

describe('buildProjectTree', () => {
  it('groups paths into a nested hierarchy with directories first', () => {
    const roots = buildProjectTree([
      { path: 'src/index.ts', type: 'file' },
      { path: 'src/lib/util.ts', type: 'file' },
      { path: 'docs/readme.md', type: 'file' },
    ]);
    expect(roots.map((r) => r.path).sort()).toEqual(['docs', 'src']);
    const src = roots.find((r) => r.path === 'src');
    expect(src?.type).toBe('directory');
    expect(src?.children[0]?.name).toBe('lib');
    expect(src?.children[0]?.type).toBe('directory');
    expect(src?.children[1]?.name).toBe('index.ts');
  });

  it('keeps top-level files at root', () => {
    const roots = buildProjectTree([{ path: 'README.md', type: 'file' }]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.path).toBe('README.md');
    expect(roots[0]?.type).toBe('file');
  });
});

describe('filterProjectTree', () => {
  it('returns the input tree unchanged when query is empty', () => {
    const tree = buildProjectTree([{ path: 'a.ts', type: 'file' }]);
    const r = filterProjectTree(tree, '');
    expect(r.filtered).toBe(tree);
    expect(r.expandPaths.size).toBe(0);
  });

  it('matches case-insensitively against path', () => {
    const tree = buildProjectTree([
      { path: 'src/Util.ts', type: 'file' },
      { path: 'src/other.ts', type: 'file' },
    ]);
    const r = filterProjectTree(tree, 'UTIL');
    expect(r.filtered).toHaveLength(1);
    expect(r.filtered[0]?.path).toBe('src');
    expect(r.filtered[0]?.children).toHaveLength(1);
    expect(r.filtered[0]?.children[0]?.name).toBe('Util.ts');
    expect(r.expandPaths.has('src')).toBe(true);
  });

  it('drops branches with no matches', () => {
    const tree = buildProjectTree([
      { path: 'src/util.ts', type: 'file' },
      { path: 'docs/readme.md', type: 'file' },
    ]);
    const r = filterProjectTree(tree, 'util');
    expect(r.filtered.map((n) => n.path)).toEqual(['src']);
  });
});
