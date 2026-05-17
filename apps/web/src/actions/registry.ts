// ActionSpec registry — populated from bridge `system.capabilities` event.

import { create } from 'zustand';
import type { CommandScope, CommandSideEffect, CommandStatus } from '../generated/commandCatalog';

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
  source?: 'vac' | 'acp';
  command_status?: CommandStatus;
  command_scope?: CommandScope;
  command_side_effect?: CommandSideEffect;
  disabled_reason?: string;
  insert_text?: string | null;
  acp_command?: unknown;
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
