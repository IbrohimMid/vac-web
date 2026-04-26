// Current session slice (very small — full store per Plan 12 in Phase 2+).

import { create } from 'zustand';

interface SessionSlice {
  sessionId: string | null;
  profileId: string | null;
  projectRoot: string | null;
  workflowId: string | null;
  workflowName: string | null;
  setSession(id: string, profileId: string, projectRoot: string): void;
  setWorkflowId(workflowId: string | null): void;
  setWorkflowMeta(workflowId: string | null, workflowName: string | null): void;
  clear(): void;
}

export const useSession = create<SessionSlice>((set) => ({
  sessionId: null,
  profileId: null,
  projectRoot: null,
  workflowId: null,
  workflowName: null,
  setSession(id, profileId, projectRoot) {
    set({ sessionId: id, profileId, projectRoot });
  },
  setWorkflowId(workflowId) {
    set({ workflowId });
  },
  setWorkflowMeta(workflowId, workflowName) {
    set({ workflowId, workflowName });
  },
  clear() {
    set({ sessionId: null, profileId: null, projectRoot: null, workflowId: null, workflowName: null });
  },
}));
