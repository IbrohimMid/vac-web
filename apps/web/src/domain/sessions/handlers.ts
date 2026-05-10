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
  context_used?: unknown;
  contextUsed?: unknown;
  context_limit?: unknown;
  contextLimit?: unknown;
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function asArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  const obj = asObject(raw);
  if (!obj) return [];
  for (const key of ['models', 'modes', 'items', 'options', 'available']) {
    const value = obj[key];
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  return [];
}

function optionIdOf(option: Record<string, unknown>): string | null {
  return asString(option.id) ?? asString(option.option_id) ?? asString(option.optionId) ?? asString(option.name) ?? asString(option.key);
}

function modelChoicesFromConfigOptions(raw: unknown): Array<Record<string, unknown>> {
  const modelOption = asArray(raw).find((entry) => optionIdOf(entry) === 'model');
  if (!modelOption) return [];
  for (const key of ['values', 'choices', 'options', 'items', 'available', 'enum', 'models']) {
    const value = modelOption[key];
    if (Array.isArray(value)) {
      return value
        .map((item, index): Record<string, unknown> | null => {
          if (typeof item === 'string' && item.trim()) return { id: item, name: item, value: item };
          if (item && typeof item === 'object') return item as Record<string, unknown>;
          return { id: `model-${index + 1}`, name: `model-${index + 1}` };
        })
        .filter((item): item is Record<string, unknown> => item !== null);
    }
  }
  const current = modelOption.value ?? modelOption.currentValue ?? modelOption.current_value;
  return typeof current === 'string' && current.trim() ? [{ id: current, name: current, value: current }] : [];
}

function modelIdOf(entry: Record<string, unknown>, fallback: string): string {
  for (const key of ['id', 'modelId', 'model_id', 'modeId', 'mode_id', 'name', 'value']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function contextLimitOf(entry: Record<string, unknown>): number | null {
  for (const key of ['contextLimit', 'context_limit', 'contextWindow', 'context_window', 'maxContextTokens', 'max_context_tokens']) {
    const direct = asNumber(entry[key]);
    if (direct !== null) return direct;
  }
  const nested = asObject(entry.context) ?? asObject(entry.context_window) ?? asObject(entry.contextWindow);
  if (nested) {
    for (const key of ['limit', 'window', 'tokens', 'maxTokens', 'max_tokens']) {
      const value = asNumber(nested[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function contextLimitForModel(modelId: string | null, sources: unknown[]): number | null {
  if (!modelId) return null;
  for (const source of sources) {
    const entries = [...asArray(source), ...modelChoicesFromConfigOptions(source)];
    const match = entries.find((entry, index) => modelIdOf(entry, `entry-${index + 1}`) === modelId);
    if (match) {
      const limit = contextLimitOf(match);
      if (limit !== null) return limit;
    }
  }
  return null;
}

function modelValueFromOptions(raw: unknown): string | null {
  for (const option of asArray(raw)) {
    if (optionIdOf(option) === 'model') return asString(option.value) ?? asString(option.currentValue) ?? asString(option.current_value);
  }
  return null;
}

function optionUpdateAsOptions(p: {
  option_id?: unknown;
  optionId?: unknown;
  id?: unknown;
  value?: unknown;
}): unknown[] | null {
  const id = asString(p.option_id) ?? asString(p.optionId) ?? asString(p.id);
  if (!id) return null;
  return [{ id, value: p.value }];
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
      const configOptions = p?.config_options ?? p?.configOptions ?? null;
      const currentModelId = p?.model_id ?? p?.modelId ?? p?.model ?? modelValueFromOptions(configOptions);
      useSession.getState().setAcpModelSnapshot({
        models: p?.models ?? null,
        modes: p?.modes ?? null,
        configOptions,
        currentModelId,
        contextUsed: asNumber(p?.context_used ?? p?.contextUsed),
        contextLimit:
          asNumber(p?.context_limit ?? p?.contextLimit) ??
          contextLimitForModel(currentModelId, [p?.modes, p?.models, configOptions]),
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
      if (modeId) {
        const state = useSession.getState().acpModel;
        useSession.getState().setAcpModelSnapshot({
          currentModelId: modeId,
          contextLimit: contextLimitForModel(modeId, [state.modes, state.models, state.configOptions]),
        });
      }
    }),
  );

  offs.push(
    transport.on('session.config_options.updated', (ev) => {
      const p = (ev.payload ?? {}) as {
        options?: unknown;
        config_options?: unknown;
        configOptions?: unknown;
        option_id?: unknown;
        optionId?: unknown;
        id?: unknown;
        value?: unknown;
      };
      const state = useSession.getState().acpModel;
      const patchOptions = optionUpdateAsOptions(p);
      const configOptions = p.options ?? p.config_options ?? p.configOptions ?? patchOptions ?? state.configOptions ?? null;
      const modelId = modelValueFromOptions(configOptions);
      useSession.getState().setAcpModelSnapshot({
        configOptions,
        ...(modelId
          ? {
              currentModelId: modelId,
              contextLimit: contextLimitForModel(modelId, [state.modes, state.models, configOptions]),
            }
          : {}),
      });
    }),
  );

  offs.push(
    transport.on('session.context.updated', (ev) => {
      const p = (ev.payload ?? {}) as {
        context_used?: unknown;
        contextUsed?: unknown;
        context_limit?: unknown;
        contextLimit?: unknown;
      };
      const contextUsed = asNumber(p.context_used ?? p.contextUsed);
      const contextLimit = asNumber(p.context_limit ?? p.contextLimit);
      useSession.getState().setAcpModelSnapshot({
        ...(contextUsed !== null ? { contextUsed } : {}),
        ...(contextLimit !== null ? { contextLimit } : {}),
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
