// Current session slice (very small — full store per Plan 12 in Phase 2+).

import { create } from 'zustand';

interface SessionSlice {
  sessionId: string | null;
  profileId: string | null;
  projectRoot: string | null;
  setSession(id: string, profileId: string, projectRoot: string): void;
  clear(): void;
}

export const useSession = create<SessionSlice>((set) => ({
  sessionId: null,
  profileId: null,
  projectRoot: null,
  setSession(id, profileId, projectRoot) {
    set({ sessionId: id, profileId, projectRoot });
  },
  clear() {
    set({ sessionId: null, profileId: null, projectRoot: null });
  },
}));
