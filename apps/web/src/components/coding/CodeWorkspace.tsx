// CodeWorkspace — Phase 1 shell route.
//
// Renders the workspace topbar + 3-pane layout. Every "coding" affordance
// (project browse / direct edit / preview / task lifecycle) is intentionally
// shipped as a truthful disabled / unsupported state until later phases wire
// the underlying bridge contracts. The bottom runtime drawer reuses the
// global ShellDrawer mounted in main.tsx.

import { useState } from 'react';
import type { TransportHandle } from '../../transport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspaceTopbar } from './WorkspaceTopbar';

interface Props {
  transport: TransportHandle | null;
}

type CenterTab = 'code' | 'diff' | 'preview';

export function CodeWorkspace({ transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const setRoute = useCockpit((s) => s.setRoute);
  const [centerTab, setCenterTab] = useState<CenterTab>('code');
  const goToBuild = () => setRoute('build');
  const openShell = () => useShell.getState().setOpen(true);

  return (
    <div
      className="codeworkspace"
      data-route="code"
      role="region"
      aria-label="Code workspace"
    >
      <WorkspaceTopbar transport={transport} />
      <WorkspaceLayout
        explorer={<ExplorerPane sessionId={sessionId} />}
        center={<CenterPane tab={centerTab} setTab={setCenterTab} sessionId={sessionId} />}
        agent={<AgentPane onGoToBuild={goToBuild} onOpenShell={openShell} />}
      />
    </div>
  );
}

interface ExplorerProps {
  sessionId: string | null;
}

function ExplorerPane({ sessionId }: ExplorerProps) {
  return (
    <>
      <header className="codeworkspace-pane-header">
        <span>Explorer</span>
      </header>
      <div className="codeworkspace-pane-body">
        {sessionId ? (
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
        ) : (
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
        )}
      </div>
    </>
  );
}

interface CenterPaneProps {
  tab: CenterTab;
  setTab(t: CenterTab): void;
  sessionId: string | null;
}

function CenterPane({ tab, setTab, sessionId }: CenterPaneProps) {
  return (
    <>
      <header className="codeworkspace-pane-header">
        <span
          className="codeworkspace-tablist"
          role="tablist"
          aria-label="Code workspace center"
        >
          <button
            type="button"
            className="codeworkspace-tab"
            role="tab"
            aria-selected={tab === 'code'}
            onClick={() => setTab('code')}
          >
            Code
          </button>
          <button
            type="button"
            className="codeworkspace-tab"
            role="tab"
            aria-selected={tab === 'diff'}
            onClick={() => setTab('diff')}
          >
            Diff
          </button>
          <button
            type="button"
            className="codeworkspace-tab"
            role="tab"
            aria-selected={tab === 'preview'}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
        </span>
      </header>
      <div
        className="codeworkspace-pane-body"
        role="tabpanel"
        aria-label={`Center pane: ${tab}`}
      >
        {tab === 'code' && (
          <div className="codeworkspace-empty" data-testid="code-center-empty">
            <span className="cw-empty-title">
              {sessionId ? 'Start with a task or open a file.' : 'No session'}
            </span>
            <span className="cw-empty-hint">
              File viewing arrives in Phase 2. Code panel actions land in Phase 3.
            </span>
            <span className="codeworkspace-unsupported">
              Unavailable: direct browser editing is not wired yet.
            </span>
          </div>
        )}
        {tab === 'diff' && (
          <div className="codeworkspace-empty" data-testid="code-center-diff">
            <span className="cw-empty-title">Diff viewer</span>
            <span className="cw-empty-hint">
              Hunk-level review arrives in Phase 6. Use the Build surface Review
              tab for the current diff workflow.
            </span>
            <span className="codeworkspace-unsupported">
              Unavailable: file/hunk review here is not wired yet.
            </span>
          </div>
        )}
        {tab === 'preview' && (
          <div className="codeworkspace-empty" data-testid="code-center-preview">
            <span className="cw-empty-title">App preview</span>
            <span className="cw-empty-hint">Preview panel arrives in Phase 4.</span>
            <span className="codeworkspace-unsupported">
              Unavailable: preview context capture is not wired yet.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

interface AgentPaneProps {
  onGoToBuild(): void;
  onOpenShell(): void;
}

function AgentPane({ onGoToBuild, onOpenShell }: AgentPaneProps) {
  return (
    <>
      <header className="codeworkspace-pane-header">
        <span>Agent thread</span>
      </header>
      <div className="codeworkspace-pane-body">
        <div
          className="codeworkspace-empty"
          role="status"
          data-testid="code-agent-placeholder"
        >
          <span className="cw-empty-title">Agent thread placeholder</span>
          <span className="cw-empty-hint">
            Phase 1 ships only the workspace shell. Use the Build surface for
            the live agent thread until Phase 2 wires file context here.
          </span>
          <div style= display: 'flex', gap: 6 >
            <button
              type="button"
              className="codeworkspace-link-btn"
              onClick={onGoToBuild}
            >
              Open Build surface
            </button>
            <button
              type="button"
              className="codeworkspace-link-btn"
              onClick={onOpenShell}
            >
              Open runtime drawer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
