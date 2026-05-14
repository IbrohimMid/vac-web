import { useState } from 'react';
import type { TransportHandle } from '../../transport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { CodePanel } from './CodePanel';
import { ProjectExplorer } from './ProjectExplorer';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspaceTopbar } from './WorkspaceTopbar';

interface Props { transport: TransportHandle | null; }
type CenterTab = 'code' | 'diff' | 'preview';

export function CodeWorkspace({ transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const setRoute = useCockpit((s) => s.setRoute);
  const [centerTab, setCenterTab] = useState<CenterTab>('code');
  const goToBuild = () => setRoute('build');
  const openShell = () => useShell.getState().setOpen(true);
  return (
    <div className="codeworkspace" data-route="code" role="region" aria-label="Code workspace">
      <WorkspaceTopbar transport={transport} />
      <WorkspaceLayout
        explorer={<ProjectExplorer sessionId={sessionId} transport={transport} />}
        center={<CenterPane tab={centerTab} setTab={setCenterTab} sessionId={sessionId} transport={transport} />}
        agent={<AgentPane onGoToBuild={goToBuild} onOpenShell={openShell} />}
      />
    </div>
  );
}

interface CenterPaneProps { tab: CenterTab; setTab(t: CenterTab): void; sessionId: string | null; transport: TransportHandle | null; }
function CenterPane({ tab, setTab, sessionId, transport }: CenterPaneProps) {
  return (
    <>
      <header className="codeworkspace-pane-header">
        <span className="codeworkspace-tablist" role="tablist" aria-label="Code workspace center">
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>Code</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>Diff</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
        </span>
      </header>
      <div className="codeworkspace-pane-body" role="tabpanel" aria-label={`Center pane: ${tab}`}>
        {tab === 'code' && (<CodePanel sessionId={sessionId} transport={transport} />)}
        {tab === 'diff' && (
          <div className="codeworkspace-empty" data-testid="code-center-diff">
            <span className="cw-empty-title">Diff viewer</span>
            <span className="cw-empty-hint">Hunk-level review arrives in Phase 6. Use the Build surface Review tab for the current diff workflow.</span>
            <span className="codeworkspace-unsupported">Unavailable: file/hunk review here is not wired yet.</span>
          </div>
        )}
        {tab === 'preview' && (
          <div className="codeworkspace-empty" data-testid="code-center-preview">
            <span className="cw-empty-title">App preview</span>
            <span className="cw-empty-hint">Preview panel arrives in Phase 4.</span>
            <span className="codeworkspace-unsupported">Unavailable: preview context capture is not wired yet.</span>
          </div>
        )}
      </div>
    </>
  );
}

interface AgentPaneProps { onGoToBuild(): void; onOpenShell(): void; }
function AgentPane({ onGoToBuild, onOpenShell }: AgentPaneProps) {
  return (
    <>
      <header className="codeworkspace-pane-header"><span>Agent thread</span></header>
      <div className="codeworkspace-pane-body">
        <div className="codeworkspace-empty" role="status" data-testid="code-agent-placeholder">
          <span className="cw-empty-title">Agent thread placeholder</span>
          <span className="cw-empty-hint">Phase 1 ships only the workspace shell. Use the Build surface for the live agent thread until later phases wire file context here.</span>
          <div className="codeworkspace-agent-actions">
            <button type="button" className="codeworkspace-link-btn" onClick={onGoToBuild}>Open Build surface</button>
            <button type="button" className="codeworkspace-link-btn" onClick={onOpenShell}>Open runtime drawer</button>
          </div>
        </div>
      </div>
    </>
  );
}
