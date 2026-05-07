// Extensions store: caches the trust catalog snapshot from the bridge.
//
// Driven by extensions.list_response / extensions.updated frames
// (see apps/web/src/domain/extensions/handlers.ts). UI calls
// requestList / updateTrust which dispatch ClientCommand frames
// via the transport.
//
// Slice #4 (2026-05-07): extensions.update_trust is now scope: session
// and is gated by the profile-layer (`enforce_action`). The session
// profile must list `extensions.update_trust` in its `tool_allow`. We
// read the active sessionId from useSession when dispatching
// update_trust; extensions.list remains sessionless.

import { create } from 'zustand';
import type {
  ExtensionEntry,
  ExtensionTier,
  ExtensionsListPayload,
} from '../domain/extensions/types';
import type { TransportHandle } from '../transport';
import { useSession } from './session';

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ExtensionsSlice {
  version: number;
  allowUnsigned: boolean;
  publishers: string[];
  entries: Map<string, ExtensionEntry>;
  order: string[];
  status: RequestStatus;
  error: string | null;
  lastUpdated: string | null;

  setSnapshot(payload: ExtensionsListPayload): void;
  upsertEntry(entry: ExtensionEntry): void;
  setStatus(status: RequestStatus, error?: string | null): void;
  clear(): void;

  requestList(transport: TransportHandle | null): Promise<boolean>;
  updateTrust(
    transport: TransportHandle | null,
    extensionId: string,
    tier: ExtensionTier,
  ): Promise<boolean>;
}

function errMessage(ack: { error?: { message?: string } | null }, fallback: string): string {
  return ack.error?.message ?? fallback;
}

export const useExtensions = create<ExtensionsSlice>((set, get) => ({
  version: 0,
  allowUnsigned: false,
  publishers: [],
  entries: new Map(),
  order: [],
  status: 'idle',
  error: null,
  lastUpdated: null,

  setSnapshot(payload) {
    const entries = new Map<string, ExtensionEntry>();
    const order: string[] = [];
    for (const e of payload.entries) {
      entries.set(e.id, e);
      order.push(e.id);
    }
    set({
      version: payload.version,
      allowUnsigned: payload.allow_unsigned,
      publishers: [...payload.publishers],
      entries,
      order,
      status: 'ready',
      error: null,
      lastUpdated: new Date().toISOString(),
    });
  },

  upsertEntry(entry) {
    set((s) => {
      const entries = new Map(s.entries);
      const order = entries.has(entry.id) ? s.order : [...s.order, entry.id];
      entries.set(entry.id, entry);
      return {
        entries,
        order,
        lastUpdated: new Date().toISOString(),
      };
    });
  },

  setStatus(status, error = null) {
    set({ status, error });
  },

  clear() {
    set({
      version: 0,
      allowUnsigned: false,
      publishers: [],
      entries: new Map(),
      order: [],
      status: 'idle',
      error: null,
      lastUpdated: null,
    });
  },

  async requestList(transport) {
    if (!transport) {
      get().setStatus('error', 'no transport');
      return false;
    }
    get().setStatus('loading');
    const ack = await transport.send('', 'extensions.list', {});
    if (!ack.ok) {
      get().setStatus('error', errMessage(ack, 'extensions.list failed'));
      return false;
    }
    // Status flips to 'ready' when extensions.list_response lands.
    return true;
  },

  async updateTrust(transport, extensionId, tier) {
    if (!transport) {
      get().setStatus('error', 'no transport');
      return false;
    }
    const sessionId = useSession.getState().sessionId;
    if (!sessionId) {
      get().setStatus('error', 'no active session');
      return false;
    }
    const ack = await transport.send(sessionId, 'extensions.update_trust', {
      extension_id: extensionId,
      tier,
    });
    if (!ack.ok) {
      get().setStatus('error', errMessage(ack, 'extensions.update_trust failed'));
      return false;
    }
    return true;
  },
}));
