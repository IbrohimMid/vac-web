// WorkspaceLayout — Phase 1 shell.
// Three-pane grid: explorer / center work area / agent thread placeholder.
// The bottom runtime drawer reuses the existing global ShellDrawer mounted
// from main.tsx, so this layout does not duplicate the drawer.
// Phase 10: adds mobile bottom-tab bar for single-pane display at ≤767px.

import { useState, type ReactNode } from 'react';
import { useWorkspace } from '../../stores/workspace';

type MobileTab = 'explorer' | 'center' | 'agent';

interface Props {
  explorer: ReactNode;
  center: ReactNode;
  agent: ReactNode;
}

export function WorkspaceLayout({ explorer, center, agent }: Props) {
  const explorerCollapsed = useWorkspace((s) => s.explorerCollapsed);
  const [mobileTab, setMobileTab] = useState<MobileTab>('center');
  return (
    <div className="codeworkspace-layout-wrap">
      <div
        className="codeworkspace-body"
        data-explorer-collapsed={explorerCollapsed ? 'true' : 'false'}
        data-mobile-tab={mobileTab}
        role="presentation"
      >
        <section
          className="codeworkspace-pane codeworkspace-pane-explorer"
          aria-label="Project explorer"
          aria-hidden={explorerCollapsed ? 'true' : 'false'}
        >
          {explorer}
        </section>
        <section
          className="codeworkspace-pane codeworkspace-pane-center"
          aria-label="Code workspace primary"
        >
          {center}
        </section>
        <section
          className="codeworkspace-pane codeworkspace-pane-agent"
          aria-label="Agent thread"
        >
          {agent}
        </section>
      </div>
      <nav className="codeworkspace-mobile-tabs" aria-label="Mobile workspace tabs">
        <button
          type="button"
          className="codeworkspace-mobile-tab"
          aria-selected={mobileTab === 'explorer'}
          onClick={() => setMobileTab('explorer')}
        >
          Explorer
        </button>
        <button
          type="button"
          className="codeworkspace-mobile-tab"
          aria-selected={mobileTab === 'center'}
          onClick={() => setMobileTab('center')}
        >
          Code
        </button>
        <button
          type="button"
          className="codeworkspace-mobile-tab"
          aria-selected={mobileTab === 'agent'}
          onClick={() => setMobileTab('agent')}
        >
          Task
        </button>
      </nav>
    </div>
  );
}
