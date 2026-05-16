import { useState } from 'react';
import type { TransportHandle } from '../../transport';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { CodePanel } from './CodePanel';
import { ProjectExplorer } from './ProjectExplorer';
import { TaskBoard } from './TaskBoard';
import { PreviewPanel } from './PreviewPanel';
import { ReviewQueue } from './ReviewQueue';
import { MutationInbox, useMutationInboxPendingCount } from './MutationInbox';
import { AuditTrail, useAuditEntryCount } from './AuditTrail';
import { ValidationPanel } from './ValidationPanel';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspaceTopbar } from './WorkspaceTopbar';
import { CodeOnboarding } from './CodeOnboarding';

interface Props { transport: TransportHandle | null; }
type CenterTab = 'code' | 'inbox' | 'diff' | 'preview' | 'validation' | 'audit';

export function CodeWorkspace({ transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const setRoute = useCockpit((s) => s.setRoute);
  const density = useCockpit((s) => s.density);
  const [centerTab, setCenterTab] = useState<CenterTab>('code');
  const goToBuild = () => setRoute('build');
  const openShell = () => useShell.getState().setOpen(true);
  return (
    <div className="codeworkspace" data-route="code" data-density={density} role="region" aria-label="Code workspace">
      <WorkspaceTopbar transport={transport} />
      <CodeOnboarding
        sessionId={sessionId}
        transport={transport}
        onOpenBuild={goToBuild}
        onOpenRuntime={openShell}
        onSelectTab={setCenterTab}
      />
      <WorkspaceLayout
        explorer={<ProjectExplorer sessionId={sessionId} transport={transport} />}
        center={<CenterPane tab={centerTab} setTab={setCenterTab} sessionId={sessionId} transport={transport} />}
        agent={<AgentPane sessionId={sessionId} transport={transport} onGoToBuild={goToBuild} onOpenShell={openShell} />}
      />
    </div>
  );
}

interface CenterPaneProps { tab: CenterTab; setTab(t: CenterTab): void; sessionId: string | null; transport: TransportHandle | null; }
function CenterPane({ tab, setTab, sessionId, transport }: CenterPaneProps) {
  const pendingMutationCount = useMutationInboxPendingCount();
  const auditCount = useAuditEntryCount();
  return (
    <>
      <header className="codeworkspace-pane-header">
        <span className="codeworkspace-tablist" role="tablist" aria-label="Code workspace center">
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>Code</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')} data-testid="inbox-tab">{pendingMutationCount > 0 ? `Inbox (${pendingMutationCount})` : 'Inbox'}</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>Diff</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'validation'} onClick={() => setTab('validation')}>Validation</button>
          <button type="button" className="codeworkspace-tab" role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')} data-testid="audit-tab">{auditCount > 0 ? `Audit (${auditCount})` : 'Audit'}</button>
        </span>
      </header>
      <div className="codeworkspace-pane-body" role="tabpanel" aria-label={`Center pane: ${tab}`}>
        {tab === 'code' && (<CodePanel sessionId={sessionId} transport={transport} />)}
        {tab === 'inbox' && (<MutationInbox transport={transport} />)}
        {tab === 'diff' && (<ReviewQueue transport={transport} />)}
        {tab === 'preview' && (<PreviewPanel sessionId={sessionId} transport={transport} />)}
        {tab === 'validation' && (<ValidationPanel transport={transport} />)}
        {tab === 'audit' && (<AuditTrail />)}
      </div>
    </>
  );
}

interface AgentPaneProps { sessionId: string | null; transport: TransportHandle | null; onGoToBuild(): void; onOpenShell(): void; }
function AgentPane({ sessionId, transport, onGoToBuild, onOpenShell }: AgentPaneProps) {
  return (
    <>
      <header className="codeworkspace-pane-header"><span>Task lifecycle</span></header>
      <div className="codeworkspace-pane-body">
        <TaskBoard sessionId={sessionId} transport={transport} />
        <div className="codeworkspace-agent-actions">
          <button type="button" className="codeworkspace-link-btn" onClick={onGoToBuild}>Open Build surface</button>
          <button type="button" className="codeworkspace-link-btn" onClick={onOpenShell}>Open runtime drawer</button>
        </div>
      </div>
    </>
  );
}
