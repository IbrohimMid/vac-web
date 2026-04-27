// Cockpit view state — Stage B shell.
// Theme, density, accent, sidebar/rail collapsed flags, current route, rail
// tab, active gate. Persisted to localStorage so reloads keep the user's
// chosen layout.

import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type Density = 'compact' | 'regular' | 'comfy';
export type Route =
  | 'build'
  | 'assess'
  | 'handoff'
  | 'release'
  | 'knowledge'
  | 'sessions';
export type RailTab = 'Activity' | 'Notify' | 'Context' | 'Memory';

const STORAGE_KEY = 'vac-web.cockpit';

interface Persisted {
  theme: Theme;
  density: Density;
  accent: string;
  sidebarCollapsed: boolean;
  railCollapsed: boolean;
}

const DEFAULTS: Persisted = {
  theme: 'light',
  density: 'regular',
  accent: '#0fb6a8',
  sidebarCollapsed: false,
  railCollapsed: false,
};

function loadPersisted(): Persisted {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : DEFAULTS.theme,
      density:
        parsed.density === 'compact' || parsed.density === 'comfy'
          ? parsed.density
          : 'regular',
      accent: typeof parsed.accent === 'string' ? parsed.accent : DEFAULTS.accent,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      railCollapsed: Boolean(parsed.railCollapsed),
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(p: Persisted): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota or unavailable; ignore */
  }
}

interface CockpitSlice extends Persisted {
  route: Route;
  railTab: RailTab;
  activeGateId: string | null;
  setTheme(t: Theme): void;
  setDensity(d: Density): void;
  setAccent(a: string): void;
  setSidebarCollapsed(c: boolean): void;
  setRailCollapsed(c: boolean): void;
  setRoute(r: Route): void;
  setRailTab(t: RailTab): void;
  setActiveGate(id: string | null): void;
}

const initial = loadPersisted();

export const useCockpit = create<CockpitSlice>((set) => ({
  ...initial,
  route: 'build',
  railTab: 'Activity',
  activeGateId: null,
  setTheme(theme) {
    set((s) => {
      const next = { ...s, theme };
      persist(next);
      return { theme };
    });
  },
  setDensity(density) {
    set((s) => {
      const next = { ...s, density };
      persist(next);
      return { density };
    });
  },
  setAccent(accent) {
    set((s) => {
      const next = { ...s, accent };
      persist(next);
      return { accent };
    });
  },
  setSidebarCollapsed(sidebarCollapsed) {
    set((s) => {
      const next = { ...s, sidebarCollapsed };
      persist(next);
      return { sidebarCollapsed };
    });
  },
  setRailCollapsed(railCollapsed) {
    set((s) => {
      const next = { ...s, railCollapsed };
      persist(next);
      return { railCollapsed };
    });
  },
  setRoute(route) {
    set({ route });
  },
  setRailTab(railTab) {
    set({ railTab });
  },
  setActiveGate(activeGateId) {
    set({ activeGateId });
  },
}));

// Accent palette mirrors vacweb/app.jsx ACCENTS so the tweaks panel can
// expose the same swatches without duplicating the table.
export const ACCENT_PRESETS = [
  { name: 'Mint', v: '#0fb6a8', v2: '#0a9b8e', soft: '#d6f4f0', soft2: '#ebf9f6' },
  { name: 'Sky', v: '#3aa5e0', v2: '#2a8bc6', soft: '#dfeefb', soft2: '#eef6fc' },
  { name: 'Sage', v: '#5fa371', v2: '#488a59', soft: '#dfeede', soft2: '#eef6ee' },
  { name: 'Lilac', v: '#9377d8', v2: '#7a5fc4', soft: '#e8e0f7', soft2: '#f1ecfa' },
  { name: 'Coral', v: '#e08465', v2: '#c66a4d', soft: '#fadfd2', soft2: '#fbeee6' },
] as const;
