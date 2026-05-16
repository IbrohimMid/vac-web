import { useEffect } from 'react';
import type { TransportHandle } from '../../transport';
import {
  useProject,
  type ProjectEntry,
  type ProjectTreeStatus,
} from '../../stores/project';
import { useReview, type ReviewFile } from '../../stores/review';
import {
  requestProjectFile,
  requestProjectTree,
} from '../../domain/project/handlers';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
}

export interface ProjectTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children: ProjectTreeNode[];
}

function lastSegment(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.substring(i + 1);
}

export function buildProjectTree(entries: ProjectEntry[]): ProjectTreeNode[] {
  const nodes = new Map<string, ProjectTreeNode>();
  for (const e of entries) {
    const node: ProjectTreeNode = {
      path: e.path,
      name: lastSegment(e.path),
      type: e.type,
      children: [],
    };
    if (typeof e.size === 'number') node.size = e.size;
    nodes.set(e.path, node);
  }
  // Derive intermediate directories from file paths.
  for (const e of entries) {
    const parts = e.path.split('/').filter((s) => s.length > 0);
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (!nodes.has(dirPath)) {
        nodes.set(dirPath, {
          path: dirPath,
          name: parts[i - 1] ?? dirPath,
          type: 'directory',
          children: [],
        });
      }
    }
  }
  const roots: ProjectTreeNode[] = [];
  for (const [path, node] of nodes.entries()) {
    const idx = path.lastIndexOf('/');
    if (idx === -1) {
      roots.push(node);
    } else {
      const parentPath = path.substring(0, idx);
      const parent = nodes.get(parentPath);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  const cmp = (a: ProjectTreeNode, b: ProjectTreeNode) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  };
  const sortRec = (list: ProjectTreeNode[]) => {
    list.sort(cmp);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export interface ProjectTreeFilterResult {
  filtered: ProjectTreeNode[];
  expandPaths: Set<string>;
}

export function filterProjectTree(
  tree: ProjectTreeNode[],
  query: string,
): ProjectTreeFilterResult {
  const expandPaths = new Set<string>();
  const lower = query.trim().toLowerCase();
  if (!lower) return { filtered: tree, expandPaths };
  function walk(node: ProjectTreeNode): ProjectTreeNode | null {
    const selfMatch = node.path.toLowerCase().includes(lower);
    const kids: ProjectTreeNode[] = [];
    for (const c of node.children) {
      const r = walk(c);
      if (r) kids.push(r);
    }
    if (selfMatch || kids.length > 0) {
      if (node.type === 'directory') expandPaths.add(node.path);
      const next: ProjectTreeNode = {
        path: node.path,
        name: node.name,
        type: node.type,
        children: kids,
      };
      if (typeof node.size === 'number') next.size = node.size;
      return next;
    }
    return null;
  }
  const out: ProjectTreeNode[] = [];
  for (const r of tree) {
    const f = walk(r);
    if (f) out.push(f);
  }
  return { filtered: out, expandPaths };
}

export function ProjectExplorer({ sessionId, transport }: Props) {
  const treeStatus = useProject((s) => s.treeStatus);
  const entries = useProject((s) => s.entries);
  const treeError = useProject((s) => s.treeError);
  const selectedFilePath = useProject((s) => s.selectedFilePath);
  const reviewFiles = useReview((s) => s.files);
  const expanded = useProject((s) => s.expanded);
  const filter = useProject((s) => s.filter);
  const truncated = useProject((s) => s.truncated);
  const entryCount = useProject((s) => s.entryCount);
  const capReason = useProject((s) => s.capReason);
  const includeHidden = useProject((s) => s.treeOptions.includeHidden ?? false);

  useEffect(() => {
    if (!sessionId || !transport) return;
    if (treeStatus !== 'idle') return;
    void requestProjectTree(transport, sessionId);
  }, [sessionId, transport, treeStatus]);

  const onSelectFile = (path: string) => {
    useProject.getState().selectPath(path);
    if (transport && sessionId) {
      void requestProjectFile(transport, sessionId, path);
    }
  };

  const onToggleHidden = () => {
    useProject.getState().setTreeOptions({ includeHidden: !includeHidden });
    if (transport && sessionId) void requestProjectTree(transport, sessionId);
  };

  const onRefresh = () => {
    if (transport && sessionId) void requestProjectTree(transport, sessionId);
  };

  const showControls = treeStatus === 'loaded' || treeStatus === 'empty';

  return (
    <>
      <header className="codeworkspace-pane-header">
        <span>Explorer</span>
        {showControls ? (
          <button
            type="button"
            className="codeworkspace-link-btn"
            data-testid="code-explorer-refresh"
            onClick={onRefresh}
            disabled={!transport || !sessionId}
          >
            Refresh
          </button>
        ) : null}
      </header>
      <div className="codeworkspace-pane-body">
        {showControls ? (
          <div className="codeworkspace-explorer-controls">
            <input
              type="text"
              className="codeworkspace-explorer-filter"
              data-testid="code-explorer-filter"
              placeholder="Filter files..."
              value={filter}
              onChange={(e) => useProject.getState().setFilter(e.target.value)}
            />
            <label className="codeworkspace-explorer-toggle">
              <input
                type="checkbox"
                data-testid="code-explorer-include-hidden"
                checked={includeHidden}
                onChange={onToggleHidden}
              />
              <span>Show hidden</span>
            </label>
          </div>
        ) : null}
        {truncated ? (
          <div
            className="codeworkspace-explorer-truncated"
            role="status"
            data-testid="code-explorer-truncated"
          >
            <span className="cw-truncated-title">Tree truncated</span>
            <span className="cw-truncated-meta">
              Showing {entryCount ?? entries.length} entries
              {capReason ? ` (${capReason})` : ''}
            </span>
          </div>
        ) : null}
        {renderBody({
          sessionId,
          transport,
          treeStatus,
          entries,
          treeError,
          selectedFilePath,
          reviewFiles,
          expanded,
          filter,
          onSelectFile,
        })}
      </div>
    </>
  );
}

interface BodyArgs {
  sessionId: string | null;
  transport: TransportHandle | null;
  treeStatus: ProjectTreeStatus;
  entries: ProjectEntry[];
  treeError: string | null;
  selectedFilePath: string | null;
  reviewFiles: ReviewFile[];
  expanded: Record<string, boolean>;
  filter: string;
  onSelectFile: (path: string) => void;
}

function renderBody(args: BodyArgs) {
  const {
    sessionId,
    transport,
    treeStatus,
    entries,
    treeError,
    selectedFilePath,
    reviewFiles,
    expanded,
    filter,
    onSelectFile,
  } = args;
  if (!sessionId) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-empty">
        <span className="cw-empty-title">No session</span>
        <span className="cw-empty-hint">Connect a session to browse project files.</span>
      </div>
    );
  }
  if (!transport) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-unsupported">
        <span className="cw-empty-title">Project tree</span>
        <span className="cw-empty-hint">Connect a session to browse project files.</span>
        <span className="codeworkspace-unsupported">Unavailable: bridge does not support project file browsing yet.</span>
      </div>
    );
  }
  if (treeStatus === 'idle' || treeStatus === 'requesting') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-loading">
        <span className="cw-empty-title">Requesting project tree...</span>
        <span className="cw-empty-hint">Waiting for the bridge to respond.</span>
      </div>
    );
  }
  if (treeStatus === 'empty') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-empty-tree">
        <span className="cw-empty-title">Empty project</span>
        <span className="cw-empty-hint">The bridge returned an empty project tree.</span>
      </div>
    );
  }
  if (treeStatus === 'error') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-error">
        <span className="cw-empty-title">Tree error</span>
        <span className="cw-empty-hint">{treeError ?? 'Unknown error from the bridge.'}</span>
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={() => { if (transport && sessionId) void requestProjectTree(transport, sessionId); }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (treeStatus === 'unsupported') {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-unsupported">
        <span className="cw-empty-title">Project tree</span>
        <span className="cw-empty-hint">Connect a session to browse project files.</span>
        <span className="codeworkspace-unsupported">Unavailable: bridge does not support project file browsing yet.</span>
        {treeError ? <span className="cw-empty-hint cw-empty-detail">{treeError}</span> : null}
      </div>
    );
  }
  const tree = buildProjectTree(entries);
  const { filtered, expandPaths } = filterProjectTree(tree, filter);
  if (filter.trim() && filtered.length === 0) {
    return (
      <div className="codeworkspace-empty" role="status" data-testid="code-explorer-no-matches">
        <span className="cw-empty-title">No matches</span>
        <span className="cw-empty-hint">No entries match the filter.</span>
      </div>
    );
  }
  const filterActive = filter.trim().length > 0;
  return (
    <ul className="codeworkspace-tree" role="tree" aria-label="Project files" data-testid="code-explorer-tree">
      {filtered.map((node) =>
        renderNode({
          node,
          depth: 0,
          expanded,
          filterActive,
          expandPaths,
          selectedFilePath,
          reviewFiles,
          onSelectFile,
        }),
      )}
    </ul>
  );
}

interface NodeArgs {
  node: ProjectTreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  filterActive: boolean;
  expandPaths: Set<string>;
  selectedFilePath: string | null;
  reviewFiles: ReviewFile[];
  onSelectFile: (path: string) => void;
}

function renderNode(args: NodeArgs) {
  const {
    node,
    depth,
    expanded,
    filterActive,
    expandPaths,
    selectedFilePath,
    reviewFiles,
    onSelectFile,
  } = args;
  const indentStyle = { paddingLeft: `${depth * 16 + 8}px` };
  if (node.type === 'directory') {
    const isExpanded = filterActive
      ? expandPaths.has(node.path)
      : (expanded[node.path] ?? false);
    return (
      <li
        key={node.path}
        className={
          'codeworkspace-tree-item codeworkspace-tree-item-dir' +
          (isExpanded ? ' codeworkspace-tree-item-expanded' : '')
        }
        role="treeitem"
        aria-expanded={isExpanded}
        data-type="directory"
        data-path={node.path}
      >
        <div
          className="codeworkspace-tree-row"
          style={indentStyle}
          data-testid="code-explorer-row-dir"
          onClick={() => useProject.getState().toggleExpanded(node.path)}
        >
          <span className="codeworkspace-tree-caret" aria-hidden="true">{isExpanded ? '\u25BE' : '\u25B8'}</span>
          <span className="codeworkspace-tree-icon" aria-hidden="true">{'\u{1F4C1}'}</span>
          <span className="codeworkspace-tree-label">{node.name}</span>
        </div>
        {isExpanded ? (
          <ul className="codeworkspace-tree-children" role="group">
            {node.children.map((c) =>
              renderNode({ ...args, node: c, depth: depth + 1 }),
            )}
          </ul>
        ) : null}
      </li>
    );
  }
  const isSelected = node.path === selectedFilePath;
  const isChanged = reviewFiles.some((f) => f.path === node.path);
  return (
    <li
      key={node.path}
      className={
        'codeworkspace-tree-item codeworkspace-tree-item-file' +
        (isSelected ? ' codeworkspace-tree-item-selected' : '') +
        (isChanged ? ' codeworkspace-tree-item-changed' : '')
      }
      role="treeitem"
      aria-selected={isSelected ? 'true' : undefined}
      data-type="file"
      data-path={node.path}
      data-changed={isChanged ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
    >
      <div
        className="codeworkspace-tree-row"
        style={indentStyle}
        data-testid="code-explorer-row-file"
        onClick={() => onSelectFile(node.path)}
      >
        <span className="codeworkspace-tree-caret" aria-hidden="true">{' '}</span>
        <span className="codeworkspace-tree-icon" aria-hidden="true">{'\u{1F4C4}'}</span>
        <span className="codeworkspace-tree-label">{node.name}</span>
        {isChanged ? <span className="codeworkspace-tree-badge" data-testid="code-explorer-changed" title="This file has pending changes">changed</span> : null}
        {typeof node.size === 'number' ? <span className="codeworkspace-tree-meta">{node.size}</span> : null}
      </div>
    </li>
  );
}
