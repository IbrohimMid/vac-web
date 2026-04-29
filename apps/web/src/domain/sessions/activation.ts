import { normalizeAuthMethods } from './auth';
import { useActivity } from '../../stores/activity';
import { useApprovals } from '../../stores/approvals';
import { useAssessment } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useAttachments } from '../../stores/attachments';
import { useCockpit } from '../../stores/cockpit';
import { useContinuous } from '../../stores/continuous';
import { useGates } from '../../stores/gates';
import { useHandoff } from '../../stores/handoff';
import { useMigration } from '../../stores/migration';
import { useRelease } from '../../stores/release';
import { useReview } from '../../stores/review';
import { useRuntime } from '../../stores/runtime';
import { useSession } from '../../stores/session';
import { useShell } from '../../stores/shell';
import { useAgentSession } from '../../stores/agentSession';
import { useToolActivity } from '../../stores/toolActivity';
import { useTranscript } from '../../stores/transcript';
import { useOverlays } from '../../stores/overlays';

interface SessionReadyLike {
  session_id?: unknown;
  sessionId?: unknown;
  profile_id?: unknown;
  profileId?: unknown;
  project_root?: unknown;
  projectRoot?: unknown;
  agent_id?: unknown;
  agentId?: unknown;
  agent_kind?: unknown;
  agentKind?: unknown;
  workflow_id?: unknown;
  workflowId?: unknown;
  workflow_name?: unknown;
  workflowName?: unknown;
  auth_methods?: unknown;
  authMethods?: unknown;
  agent_capabilities?: unknown;
  agentCapabilities?: unknown;
  agent_info?: unknown;
  agentInfo?: unknown;
}

export interface SessionActivationFallback {
  profileId?: string;
  projectRoot?: string;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function stringField(src: SessionReadyLike, snake: keyof SessionReadyLike, camel: keyof SessionReadyLike): string | null {
  return asString(src[snake]) ?? asString(src[camel]);
}

function clearSessionBoundStores(): void {
  useApprovals.getState().clear();
  useAssessment.getState().clear();
  useAssessmentReport.getState().clear();
  useAttachments.getState().clear();
  useActivity.getState().clear();
  useGates.getState().clear();
  useHandoff.getState().clear();
  useMigration.getState().clear();
  useRelease.getState().clear();
  useReview.getState().clear();
  useRuntime.getState().clear();
  useAgentSession.getState().clear();
  useToolActivity.getState().clear();
  useTranscript.getState().clear();
  useContinuous.getState().clear();
  useOverlays.getState().dismissAll();
  useShell.getState().setOpen(false);
  useShell.getState().setShellId(null);
}

export function activateSessionFromReady(
  payload: unknown,
  fallback: SessionActivationFallback = {},
): string | null {
  const src = asRecord(payload) as SessionReadyLike;
  const sessionId = stringField(src, 'session_id', 'sessionId');
  if (!sessionId) return null;

  const profileId = stringField(src, 'profile_id', 'profileId') ?? fallback.profileId ?? 'unknown';
  const projectRoot = stringField(src, 'project_root', 'projectRoot') ?? fallback.projectRoot ?? '';
  const agentId = stringField(src, 'agent_id', 'agentId');
  const agentKind = stringField(src, 'agent_kind', 'agentKind');
  const workflowId = stringField(src, 'workflow_id', 'workflowId');
  const workflowName = stringField(src, 'workflow_name', 'workflowName');
  const authMethods = normalizeAuthMethods(src.auth_methods ?? src.authMethods);

  const rawCaps = src.agent_capabilities ?? src.agentCapabilities;
  const agentCapabilities =
    rawCaps && typeof rawCaps === 'object' && !Array.isArray(rawCaps)
      ? (rawCaps as Record<string, unknown>)
      : null;
  const rawInfo = src.agent_info ?? src.agentInfo;
  const agentInfoMeta =
    rawInfo && typeof rawInfo === 'object' && !Array.isArray(rawInfo)
      ? (rawInfo as Record<string, unknown>)
      : null;

  clearSessionBoundStores();

  const session = useSession.getState();
  session.clear();
  session.setSession(sessionId, profileId, projectRoot);
  session.setAuthMethods(authMethods);
  if (agentId || agentKind) {
    session.setAgentInfo(agentId, agentKind);
  }
  if (workflowId || workflowName) {
    session.setWorkflowMeta(workflowId, workflowName);
  }
  if (agentCapabilities) {
    session.setAgentCapabilities(agentCapabilities);
  }
  if (agentInfoMeta) {
    session.setAgentInfoMeta(agentInfoMeta);
  }

  useCockpit.getState().setRoute('build');
  return sessionId;
}
