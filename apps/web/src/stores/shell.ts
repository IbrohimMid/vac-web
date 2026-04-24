// Shell drawer state. Open/closed + active shell_id. One shell per session
// at a time in v1; additional shells land post-v1.

import { create } from 'zustand';

interface ShellSlice {
  open: boolean;
  shellId: string | null;
  setOpen(open: boolean): void;
  setShellId(id: string | null): void;
}

export const useShell = create<ShellSlice>((set) => ({
  open: false,
  shellId: null,
  setOpen(open) {
    set({ open });
  },
  setShellId(id) {
    set({ shellId: id });
  },
}));
