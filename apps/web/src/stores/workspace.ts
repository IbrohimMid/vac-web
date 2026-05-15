// Code Workspace shell store (Phase 1).
//
// Tracks browser-only UI state for the Code Workspace surface: explorer
// collapse, runtime drawer open hint (mirrored against the global ShellDrawer
// elsewhere), and a coarse activePanel pointer for keyboard / a11y wiring.
//
// Phase 1 is a shell — nothing here owns bridge state, file content, or task
// lifecycle. Those move in via Phase 2+ alongside their own stores.

import { create } from 'zustand';

export type WorkspacePanel = 'explorer' | 'code' | 'agent' | 'runtime';

interface WorkspaceSlice {
  explorerCollapsed: boolean;
  runtimeDrawerOpen: boolean;
  activePanel: WorkspacePanel;
  branchName: string | null;
  setExplorerCollapsed(c: boolean): void;
  toggleExplorerCollapsed(): void;
  setRuntimeDrawerOpen(o: boolean): void;
  toggleRuntimeDrawerOpen(): void;
  setActivePanel(p: WorkspacePanel): void;
  setBranchName(name: string | null): void;
}

export const useWorkspace = create<WorkspaceSlice>((set, get) => ({
  explorerCollapsed: false,
  runtimeDrawerOpen: false,
  activePanel: 'code',
  branchName: null,
  setExplorerCollapsed(explorerCollapsed) {
    set({ explorerCollapsed });
  },
  toggleExplorerCollapsed() {
    set({ explorerCollapsed: !get().explorerCollapsed });
  },
  setRuntimeDrawerOpen(runtimeDrawerOpen) {
    set({ runtimeDrawerOpen });
  },
  toggleRuntimeDrawerOpen() {
    set({ runtimeDrawerOpen: !get().runtimeDrawerOpen });
  },
  setActivePanel(activePanel) {
    set({ activePanel });
  },
  setBranchName(branchName) {
    set({ branchName });
  },
}));
