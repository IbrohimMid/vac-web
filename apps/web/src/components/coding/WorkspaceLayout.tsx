// WorkspaceLayout — Phase 1 shell.
// Three-pane grid: explorer / center work area / agent thread placeholder.
// The bottom runtime drawer reuses the existing global ShellDrawer mounted
// from main.tsx, so this layout does not duplicate the drawer.

import type { ReactNode } from 'react';
import { useWorkspace } from '../../stores/workspace';

interface Props {
  explorer: ReactNode;
  center: ReactNode;
  agent: ReactNode;
}

export function WorkspaceLayout({ explorer, center, agent }: Props) {
  const explorerCollapsed = useWorkspace((s) => s.explorerCollapsed);
  return (
    <div
      className="codeworkspace-body"
      data-explorer-collapsed={explorerCollapsed ? 'true' : 'false'}
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
  );
}
