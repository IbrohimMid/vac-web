// Wire session lifecycle events → sessions-list store.

import { useSessions, type SessionRow, type SessionStatus } from '../../stores/sessions';
import type { TransportHandle } from '../../transport';

function asStatus(raw: string | undefined): SessionStatus {
  if (raw === 'active' || raw === 'paused' || raw === 'closed') return raw;
  return 'active';
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
  project_root?: string;
  status?: string;
  model?: string;
  created_at?: string;
  attached_clients?: number;
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
      const row = coerceRow(ev.payload as SessionChangedPayload);
      if (row) useSessions.getState().upsert(row);
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
