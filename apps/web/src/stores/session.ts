// Current session slice (very small — full store per Plan 12 in Phase 2+).

import { create } from 'zustand';
import type { AcpAuthMethod } from '../domain/sessions/auth';

interface SessionSlice {
  sessionId: string | null;
  profileId: string | null;
  projectRoot: string | null;
  workflowId: string | null;
  workflowName: string | null;
  agentId: string | null;
  agentKind: string | null;
  authMethods: AcpAuthMethod[];
  setSession(id: string, profileId: string, projectRoot: string): void;
  setWorkflowId(workflowId: string | null): void;
  setWorkflowMeta(workflowId: string | null, workflowName: string | null): void;
  setAgentInfo(agentId: string | null, agentKind: string | null): void;
  setAuthMethods(authMethods: AcpAuthMethod[]): void;
  clear(): void;
}

export const useSession = create<SessionSlice>((set) => ({
  sessionId: null,
  profileId: null,
  projectRoot: null,
  workflowId: null,
  workflowName: null,
  agentId: null,
  agentKind: null,
  authMethods: [],
  setSession(id, profileId, projectRoot) {
    set({ sessionId: id, profileId, projectRoot });
  },
  setWorkflowId(workflowId) {
    set({ workflowId });
  },
  setWorkflowMeta(workflowId, workflowName) {
    set({ workflowId, workflowName });
  },
  setAgentInfo(agentId, agentKind) {
    set({ agentId, agentKind });
  },
  setAuthMethods(authMethods) {
    set({ authMethods });
  },
  clear() {
    set({
      sessionId: null,
      profileId: null,
      projectRoot: null,
      workflowId: null,
      workflowName: null,
      agentId: null,
      agentKind: null,
      authMethods: [],
    });
  },
}));
