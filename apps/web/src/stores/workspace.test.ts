// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './workspace';

describe('useWorkspace store (Phase 1 shell)', () => {
  afterEach(() => {
    useWorkspace.setState({
      explorerCollapsed: false,
      runtimeDrawerOpen: false,
      activePanel: 'code',
      branchName: null,
    });
  });

  it('exposes default shell state', () => {
    const s = useWorkspace.getState();
    expect(s.explorerCollapsed).toBe(false);
    expect(s.runtimeDrawerOpen).toBe(false);
    expect(s.activePanel).toBe('code');
    expect(s.branchName).toBeNull();
  });

  it('toggles explorer collapsed', () => {
    useWorkspace.getState().toggleExplorerCollapsed();
    expect(useWorkspace.getState().explorerCollapsed).toBe(true);
    useWorkspace.getState().toggleExplorerCollapsed();
    expect(useWorkspace.getState().explorerCollapsed).toBe(false);
  });

  it('toggles runtime drawer', () => {
    useWorkspace.getState().toggleRuntimeDrawerOpen();
    expect(useWorkspace.getState().runtimeDrawerOpen).toBe(true);
    useWorkspace.getState().setRuntimeDrawerOpen(false);
    expect(useWorkspace.getState().runtimeDrawerOpen).toBe(false);
  });

  it('sets branch name from bridge events', () => {
    useWorkspace.getState().setBranchName('main');
    expect(useWorkspace.getState().branchName).toBe('main');
  });

  it('switches active panel', () => {
    useWorkspace.getState().setActivePanel('agent');
    expect(useWorkspace.getState().activePanel).toBe('agent');
  });
});
