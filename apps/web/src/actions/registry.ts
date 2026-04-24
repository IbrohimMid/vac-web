// ActionSpec registry — populated from bridge `system.capabilities` event.

import { create } from 'zustand';

export interface ActionSpec {
  id: string;
  label: string;
  description: string;
  group: string;
  keybinding?: string | null;
  slash_alias?: string | null;
  palette_visible: boolean;
  required_capabilities: string[];
  available_when?: string | null;
}

interface RegistrySlice {
  actions: ActionSpec[];
  setActions(actions: ActionSpec[]): void;
  clear(): void;
}

export const useActions = create<RegistrySlice>((set) => ({
  actions: [],
  setActions(actions) {
    set({ actions });
  },
  clear() {
    set({ actions: [] });
  },
}));
