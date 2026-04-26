// Current session slice (very small — full store per Plan 12 in Phase 2+).

import { create } from 'zustand';
import type { AcpAuthMethod } from '../domain/sessions/auth';

export type AcpAuthStatus = 'idle' | 'requesting' | 'authenticated' | 'failed';

export interface AcpAuthError {
  code: string;
  message: string;
  authMethodId?: string;
  authMethodType?: string;
}

interface SessionSlice {
  sessionId: string | null;
  profileId: string | null;
  projectRoot: string | null;
  workflowId: string | null;
  workflowName: string | null;
  agentId: string | null;
  agentKind: string | null;
  authMethods: AcpAuthMethod[];
  // Stage X.5d — bridge-owned reauth status. Driven by `session.auth_*`
  // ServerEvents in `domain/sessions/handlers.ts`. The cockpit reads
  // these to render explicit reauth diagnostics rather than a generic
  // failure.
  authStatus: AcpAuthStatus;
  authError: AcpAuthError | null;
  lastAuthMethodId: string | null;
  setSession(id: string, profileId: string, projectRoot: string): void;
  setWorkflowId(workflowId: string | null): void;
  setWorkflowMeta(workflowId: string | null, workflowName: string | null): void;
  setAgentInfo(agentId: string | null, agentKind: string | null): void;
  setAuthMethods(authMethods: AcpAuthMethod[]): void;
  setAuthStatus(status: AcpAuthStatus): void;
  setAuthError(error: AcpAuthError | null): void;
  setLastAuthMethodId(id: string | null): void;
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
  authStatus: 'idle',
  authError: null,
  lastAuthMethodId: null,
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
  setAuthStatus(authStatus) {
    set({ authStatus });
  },
  setAuthError(authError) {
    set({ authError });
  },
  setLastAuthMethodId(lastAuthMethodId) {
    set({ lastAuthMethodId });
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
      authStatus: 'idle',
      authError: null,
      lastAuthMethodId: null,
    });
  },
}));
