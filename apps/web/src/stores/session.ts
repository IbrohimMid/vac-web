// Current session slice (very small — full store per Plan 12 in Phase 2+).

import { create } from 'zustand';
import type { AcpAuthMethod } from '../domain/sessions/auth';

export type AcpAuthStatus = 'idle' | 'requesting' | 'authenticated' | 'failed';

export interface AcpCommandAdvert {
  id: string;
  name: string;
  title: string;
  description: string;
  slash: string;
  raw: unknown;
}

export interface AcpModelSummary {
  currentModelId: string | null;
  models: unknown;
  modes: unknown;
  configOptions: unknown;
  contextUsed: number | null;
  contextLimit: number | null;
}

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
  agentCapabilities: Record<string, unknown> | null;
  agentInfo: Record<string, unknown> | null;
  acpCommands: AcpCommandAdvert[];
  acpModel: AcpModelSummary;
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
  setAgentCapabilities(caps: Record<string, unknown> | null): void;
  setAgentInfoMeta(info: Record<string, unknown> | null): void;
  setAcpCommands(commands: AcpCommandAdvert[]): void;
  setAcpModelSnapshot(snapshot: Partial<AcpModelSummary>): void;
  setAuthStatus(status: AcpAuthStatus): void;
  setAuthError(error: AcpAuthError | null): void;
  setLastAuthMethodId(id: string | null): void;
  clear(): void;
}

const EMPTY_ACP_MODEL: AcpModelSummary = {
  currentModelId: null,
  models: null,
  modes: null,
  configOptions: null,
  contextUsed: null,
  contextLimit: null,
};

export const useSession = create<SessionSlice>((set) => ({
  sessionId: null,
  profileId: null,
  projectRoot: null,
  workflowId: null,
  workflowName: null,
  agentId: null,
  agentKind: null,
  authMethods: [],
  agentCapabilities: null,
  agentInfo: null,
  acpCommands: [],
  acpModel: { ...EMPTY_ACP_MODEL },
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
  setAgentCapabilities(caps) {
    set({ agentCapabilities: caps });
  },
  setAgentInfoMeta(info) {
    set({ agentInfo: info });
  },
  setAcpCommands(acpCommands) {
    set({ acpCommands });
  },
  setAcpModelSnapshot(snapshot) {
    set((state) => ({ acpModel: { ...state.acpModel, ...snapshot } }));
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
      agentCapabilities: null,
      agentInfo: null,
      acpCommands: [],
      acpModel: { ...EMPTY_ACP_MODEL },
      authStatus: 'idle',
      authError: null,
      lastAuthMethodId: null,
    });
  },
}));
