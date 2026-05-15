// WorkspaceTopbar — Phase 1 shell.
// Shows repo / session / task / branch / status pills, plus quick actions
// that link back to global controls. Task / branch are static placeholders
// until Phase 5 lands a real task lifecycle.

import { useMemo } from 'react';
import type { TransportHandle } from '../../transport';
import { useTasks } from '../../stores/tasks';
import { useCockpit } from '../../stores/cockpit';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { useOverlays } from '../../stores/overlays';
import { useWorkspace } from '../../stores/workspace';
import { Kbd } from '../cockpit/primitives';

interface Props {
  transport: TransportHandle | null;
}

export function WorkspaceTopbar({ transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const profileId = useSession((s) => s.profileId);
  const projectRoot = useSession((s) => s.projectRoot);
  const activeTaskId = useTasks((s) => s.activeTaskId);
  const taskMap = useTasks((s) => s.tasks);
  const activeTask = useMemo(
    () => (activeTaskId ? taskMap.get(activeTaskId) : null),
    [activeTaskId, taskMap],
  );
  const taskLabel = activeTask ? activeTask.title.slice(0, 22) : '\u2014';
  const sidebarCollapsed = useCockpit((s) => s.sidebarCollapsed);
  const explorerCollapsed = useWorkspace((s) => s.explorerCollapsed);
  const toggleExplorer = useWorkspace((s) => s.toggleExplorerCollapsed);
  const shellOpen = useShell((s) => s.open);

  const toggleSidebar = () => {
    const c = useCockpit.getState();
    c.setSidebarCollapsed(!c.sidebarCollapsed);
  };
  const toggleShell = () => useShell.getState().setOpen(!useShell.getState().open);
  const openPalette = () =>
    useOverlays.getState().open('command_palette', { transport });

  const sessionLabel = sessionId ? sessionId.slice(0, 16) : 'No session';
  const projectLabel = projectRoot
    ? projectRoot.split('/').filter(Boolean).slice(-1)[0] || projectRoot
    : '—';
  const status = sessionId ? 'ready' : 'blocked';

  return (
    <div
      className="codeworkspace-topbar"
      role="toolbar"
      aria-label="Code workspace controls"
    >
      <span className="cw-pill" title={projectRoot ?? 'no project paired'}>
        repo&nbsp;<strong>{projectLabel}</strong>
      </span>
      <span className="cw-pill" title={profileId ?? ''}>
        session&nbsp;<strong>{sessionLabel}</strong>
      </span>
      <span className="cw-pill" title={activeTask ? `Task: ${activeTask.taskId}` : 'No active task yet'}>
        task&nbsp;<strong>{taskLabel}</strong>
      </span>
      <span className="cw-pill" title="Branch not yet available from bridge">
        branch&nbsp;<strong>\u2014</strong>
      </span>
      <span
        className={`cw-pill status-${status}`}
        aria-label={`Session status: ${status === 'ready' ? 'ready' : 'not paired'}`}
      >
        {status === 'ready' ? 'ready' : 'blocked'}
      </span>
      <span className="cw-spacer" />
      <button
        type="button"
        onClick={toggleExplorer}
        aria-pressed={explorerCollapsed}
        title="Toggle explorer (Cmd/Ctrl+B)"
      >
        {explorerCollapsed ? 'Show explorer' : 'Hide explorer'}&nbsp;<Kbd>⌘B</Kbd>
      </button>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-pressed={sidebarCollapsed}
        title="Toggle cockpit sidebar"
      >
        Sidebar
      </button>
      <button
        type="button"
        onClick={toggleShell}
        aria-pressed={shellOpen}
        title="Toggle runtime drawer (Cmd/Ctrl+J)"
      >
        Runtime&nbsp;<Kbd>⌘J</Kbd>
      </button>
      <button
        type="button"
        onClick={openPalette}
        disabled={!transport}
        title="Command palette (Cmd/Ctrl+K)"
      >
        ⌘ Palette
      </button>
    </div>
  );
}
