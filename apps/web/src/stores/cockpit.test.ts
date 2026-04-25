// Vitest runs in a node environment where `window` is undefined; the cockpit
// store guards each persistence write with a `typeof window !== 'undefined'`
// check, so behavior here exercises the in-memory state only. The persistence
// path is covered manually + the type system enforces the persisted-field
// surface in the Persisted interface.

import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, useCockpit } from './cockpit';

function reset() {
  useCockpit.setState({
    theme: 'dark',
    density: 'regular',
    accent: '#0fb6a8',
    sidebarCollapsed: false,
    railCollapsed: false,
    route: 'build',
    railTab: 'Activity',
    activeGateId: null,
  });
}

describe('cockpit store', () => {
  beforeEach(reset);

  it('defaults', () => {
    const s = useCockpit.getState();
    expect(s.theme).toBe('dark');
    expect(s.density).toBe('regular');
    expect(s.route).toBe('build');
    expect(s.railTab).toBe('Activity');
  });

  it('setTheme updates in-memory state', () => {
    useCockpit.getState().setTheme('light');
    expect(useCockpit.getState().theme).toBe('light');
  });

  it('setDensity accepts every union member', () => {
    useCockpit.getState().setDensity('compact');
    expect(useCockpit.getState().density).toBe('compact');
    useCockpit.getState().setDensity('comfy');
    expect(useCockpit.getState().density).toBe('comfy');
    useCockpit.getState().setDensity('regular');
    expect(useCockpit.getState().density).toBe('regular');
  });

  it('route + railTab + activeGate setters do not throw', () => {
    useCockpit.getState().setRoute('assess');
    useCockpit.getState().setRailTab('Notify');
    useCockpit.getState().setActiveGate('DevComplete');
    const s = useCockpit.getState();
    expect(s.route).toBe('assess');
    expect(s.railTab).toBe('Notify');
    expect(s.activeGateId).toBe('DevComplete');
  });

  it('ACCENT_PRESETS exposes 5 entries with required fields', () => {
    expect(ACCENT_PRESETS).toHaveLength(5);
    for (const a of ACCENT_PRESETS) {
      expect(a.name).toBeTruthy();
      expect(a.v).toMatch(/^#[0-9a-f]{6}$/i);
      expect(a.v2).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('setAccent updates store value', () => {
    const sky = ACCENT_PRESETS.find((a) => a.name === 'Sky')!;
    useCockpit.getState().setAccent(sky.v);
    expect(useCockpit.getState().accent).toBe(sky.v);
  });

  it('collapse toggles flip independently', () => {
    useCockpit.getState().setSidebarCollapsed(true);
    expect(useCockpit.getState().sidebarCollapsed).toBe(true);
    expect(useCockpit.getState().railCollapsed).toBe(false);
    useCockpit.getState().setRailCollapsed(true);
    expect(useCockpit.getState().railCollapsed).toBe(true);
    expect(useCockpit.getState().sidebarCollapsed).toBe(true);
  });
});
