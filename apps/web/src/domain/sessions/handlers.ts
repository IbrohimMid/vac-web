// Wire session lifecycle events → sessions-list store.

import { useSessions, type SessionRow, type SessionStatus } from '../../stores/sessions';
import { useSession } from '../../stores/session';
import { normalizeAuthMethods } from './auth';
import { normalizeAcpCommand } from '../../actions/acpCommands';
import type { TransportHandle } from '../../transport';

function asStatus(raw: string | undefined): SessionStatus {
  if (raw === 'active' || raw === 'paused' || raw === 'closed') return raw;
  return 'active';
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

interface SessionListPayload {
  // Bridge currently emits bare session IDs; upgrade path keeps richer fields
  // as an optional object form once the registry carries metadata.
  sessions: Array<
    | string
    | {
        id: string;
        profile_id?: string;
        project_root?: string;
        status?: string;
        model?: string;
        created_at?: string;
        attached_clients?: number;
      }
  >;
}

interface SessionChangedPayload {
  id: string;
  profile_id?: string;
  agent_id?: string;
  agent_kind?: string;
  project_root?: string;
  status?: string;
  model?: string;
  created_at?: string;
  attached_clients?: number;
  auth_methods?: unknown;
  models?: unknown;
  modes?: unknown;
  config_options?: unknown;
  configOptions?: unknown;
  model_id?: string;
  modelId?: string;
}
function coerceRow(p: SessionChangedPayload): SessionRow | null {
  if (!p.id) return null;
  return {
    id: p.id,
    profile_id: p.profile_id ?? 'unknown',
    ...(p.project_root !== undefined ? { project_root: p.project_root } : {}),
    status: asStatus(p.status),
    ...(p.model !== undefined ? { model: p.model } : {}),
    created_at: p.created_at ?? new Date().toISOString(),
    attached_clients: p.attached_clients ?? 0,
  };
}

export function registerSessionHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('session.list_response', (ev) => {
      const p = ev.payload as SessionListPayload | null;
      if (!p?.sessions) return;
      const rows = p.sessions
        .map((r) => (typeof r === 'string' ? coerceRow({ id: r }) : coerceRow(r)))
        .filter((r): r is SessionRow => r !== null);
      useSessions.getState().setAll(rows);
    }),
  );

  offs.push(
    transport.on('session.ready', (ev) => {
      const p = ev.payload as
        | (SessionChangedPayload & { workflow_id?: string; workflow_name?: string })
        | null;
      const row = coerceRow(p as SessionChangedPayload);
      if (row) useSessions.getState().upsert(row);
      if (p?.agent_id || p?.agent_kind) {
        useSession.getState().setAgentInfo(p.agent_id ?? null, p.agent_kind ?? null);
      }
      if (p?.auth_methods !== undefined) {
        useSession.getState().setAuthMethods(normalizeAuthMethods(p.auth_methods));
      }
      if (p?.workflow_id) {
        useSession.getState().setWorkflowMeta(p.workflow_id, p.workflow_name ?? null);
      }
      useSession.getState().setAcpModelSnapshot({
        models: p?.models ?? null,
        modes: p?.modes ?? null,
        configOptions: p?.config_options ?? p?.configOptions ?? null,
        currentModelId: p?.model_id ?? p?.modelId ?? p?.model ?? null,
      });
    }),
  );

  offs.push(
    transport.on('session.available_commands.updated', (ev) => {
      const p = (ev.payload ?? {}) as { commands?: unknown };
      const commands = Array.isArray(p.commands) ? p.commands : [];
      useSession.getState().setAcpCommands(commands.map(normalizeAcpCommand));
    }),
  );

  offs.push(
    transport.on('session.mode.updated', (ev) => {
      const p = (ev.payload ?? {}) as { mode_id?: unknown; modeId?: unknown };
      const modeId = asString(p.mode_id) ?? asString(p.modeId);
      if (modeId) useSession.getState().setAcpModelSnapshot({ currentModelId: modeId });
    }),
  );

  offs.push(
    transport.on('session.config_options.updated', (ev) => {
      const p = (ev.payload ?? {}) as { options?: unknown; config_options?: unknown; configOptions?: unknown };
      useSession.getState().setAcpModelSnapshot({
        configOptions: p.options ?? p.config_options ?? p.configOptions ?? null,
      });
    }),
  );

  // Stage X.5d — bridge-owned reauth lifecycle. The bridge emits these
  // alongside its audit log; the cockpit mirrors them into the session
  // store so reauth UI can render status + diagnostics without polling.
  offs.push(
    transport.on('session.auth_requested', (ev) => {
      const p = (ev.payload ?? {}) as { auth_method_id?: string };
      const id = asString(p.auth_method_id);
      const store = useSession.getState();
      store.setAuthStatus('requesting');
      store.setAuthError(null);
      if (id) store.setLastAuthMethodId(id);
    }),
  );

  offs.push(
    transport.on('session.auth_updated', (ev) => {
      const p = (ev.payload ?? {}) as {
        auth_method_id?: string;
        auth_method_type?: string;
      };
      const id = asString(p.auth_method_id);
      const store = useSession.getState();
      store.setAuthStatus('authenticated');
      store.setAuthError(null);
      if (id) store.setLastAuthMethodId(id);
    }),
  );

  offs.push(
    transport.on('session.auth_failed', (ev) => {
      const p = (ev.payload ?? {}) as {
        auth_method_id?: string;
        auth_method_type?: string;
        code?: string;
        message?: string;
      };
      const code = asString(p.code) ?? 'auth.unknown';
      const message = asString(p.message) ?? 'reauth failed';
      const id = asString(p.auth_method_id);
      const type = asString(p.auth_method_type);
      const store = useSession.getState();
      store.setAuthStatus('failed');
      store.setAuthError({
        code,
        message,
        ...(id ? { authMethodId: id } : {}),
        ...(type ? { authMethodType: type } : {}),
      });
      if (id) store.setLastAuthMethodId(id);
    }),
  );

  offs.push(
    transport.on('session.closed', (ev) => {
      const p = ev.payload as { id?: string } | null;
      if (p?.id) useSessions.getState().remove(p.id);
    }),
  );

  return () => offs.forEach((off) => off());
}
