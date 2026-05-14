// ProjectExplorer - Phase 2 component.
//
// Renders the Code Workspace left pane. Auto-issues project.tree.request
// via domain/project/handlers when idle + session + transport. Renders all
// six states truthfully:
//   - no session         : 'Connect a session to browse project files.'
//   - no transport       : truthful unsupported copy.
//   - idle / requesting  : 'Requesting project tree...'
//   - empty              : 'Empty project'
//   - error              : message + retry
//   - unsupported        : truthful unsupported copy + reason hint
//   - loaded             : flat list of entries (no file actions yet)

import { useEffect } from 'react';
import type { TransportHandle } from '../../transport';
import {
  useProject,
  type ProjectEntry,
  type ProjectTreeStatus,
} from '../../stores/project';
import { requestProjectTree } from '../../domain/project/handlers';

interface Props {
  sessionId: string | null;
  transport: TransportHandle | null;
}

export function ProjectExplorer({ sessionId, transport }: Props) {
  const treeStatus = useProject((s) => s.treeStatus);
  const entries = useProject((s) => s.entries);
  const treeError = useProject((s) => s.treeError);

  useEffect(() => {
    if (!sessionId || !transport) return;
    if (treeStatus !== 'idle') return;
    void requestProjectTree(transport, sessionId);
  }, [sessionId, transport, treeStatus]);

  return (
    <>
      <header className="codeworkspace-pane-header">
        <span>Explorer</span>
      </header>
      <div className="codeworkspace-pane-body">
        {renderBody({ sessionId, transport, treeStatus, entries, treeError })}
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
}

function renderBody({ sessionId, transport, treeStatus, entries, treeError }: BodyArgs) {
  if (!sessionId) {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-empty"
      >
        <span className="cw-empty-title">No session</span>
        <span className="cw-empty-hint">
          Connect a session to browse project files.
        </span>
      </div>
    );
  }
  if (!transport) {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-unsupported"
      >
        <span className="cw-empty-title">Project tree</span>
        <span className="cw-empty-hint">
          Connect a session to browse project files.
        </span>
        <span className="codeworkspace-unsupported">
          Unavailable: bridge does not support project file browsing yet.
        </span>
      </div>
    );
  }
  if (treeStatus === 'idle' || treeStatus === 'requesting') {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-loading"
      >
        <span className="cw-empty-title">Requesting project tree...</span>
        <span className="cw-empty-hint">
          Waiting for the bridge to respond.
        </span>
      </div>
    );
  }
  if (treeStatus === 'empty') {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-empty-tree"
      >
        <span className="cw-empty-title">Empty project</span>
        <span className="cw-empty-hint">
          The bridge returned an empty project tree.
        </span>
      </div>
    );
  }
  if (treeStatus === 'error') {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-error"
      >
        <span className="cw-empty-title">Tree error</span>
        <span className="cw-empty-hint">
          {treeError ?? 'Unknown error from the bridge.'}
        </span>
        <button
          type="button"
          className="codeworkspace-link-btn"
          onClick={() => {
            if (transport && sessionId) {
              void requestProjectTree(transport, sessionId);
            }
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (treeStatus === 'unsupported') {
    return (
      <div
        className="codeworkspace-empty"
        role="status"
        data-testid="code-explorer-unsupported"
      >
        <span className="cw-empty-title">Project tree</span>
        <span className="cw-empty-hint">
          Connect a session to browse project files.
        </span>
        <span className="codeworkspace-unsupported">
          Unavailable: bridge does not support project file browsing yet.
        </span>
        {treeError ? (
          <span className="cw-empty-hint cw-empty-detail">{treeError}</span>
        ) : null}
      </div>
    );
  }
  return (
    <ul
      className="codeworkspace-tree"
      role="tree"
      aria-label="Project files"
      data-testid="code-explorer-tree"
    >
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="codeworkspace-tree-item"
          role="treeitem"
          data-type={entry.type}
        >
          <span className="codeworkspace-tree-icon" aria-hidden="true">
            {entry.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}'}
          </span>
          <span className="codeworkspace-tree-label">{entry.path}</span>
          {typeof entry.size === 'number' ? (
            <span className="codeworkspace-tree-meta">{entry.size}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
