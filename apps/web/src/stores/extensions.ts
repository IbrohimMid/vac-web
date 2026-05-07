// Extensions store: caches the trust catalog snapshot from the bridge plus
// the two-party promotion approval queue.
//
// Driven by extensions.list_response / extensions.updated /
// extensions.approvals_list_response / extensions.promotion_{requested,approved,denied}
// frames (see apps/web/src/domain/extensions/handlers.ts). UI calls
// requestList / updateTrust / requestPromotion / approvePromotion /
// listApprovals which dispatch ClientCommand frames via the transport.
//
// Slice #4 (2026-05-07): extensions.update_trust is now scope: session and
// is gated by the profile-layer (`enforce_action`). The session profile
// must list `extensions.update_trust` in its `tool_allow`. We read the
// active sessionId from useSession when dispatching update_trust; the same
// applies to extensions.request_promotion / approve_promotion /
// list_approvals (all scope: session per the command catalog).
//
// Slice #6 (2026-05-07): tier transitions of the form `revoked -> allowed_*`
// no longer go through extensions.update_trust directly. They are routed
// through extensions.request_promotion and require a second operator (a
// distinct WS session) to call extensions.approve_promotion before the
// trust delta lands. See ADR-0004 for the rationale.

import { create } from 'zustand';
import type {
  ApprovalsListPayload,
  ExtensionEntry,
  ExtensionTier,
  ExtensionsListPayload,
  PromotionApprovalRequest,
  PromotionTier,
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

  // Promotion approvals (Slice #6 / ADR-0004).
  approvals: Map<string, PromotionApprovalRequest>;
  approvalsOrder: string[];
  approvalsStatus: RequestStatus;
  approvalsError: string | null;

  setSnapshot(payload: ExtensionsListPayload): void;
  upsertEntry(entry: ExtensionEntry): void;
  setStatus(status: RequestStatus, error?: string | null): void;
  setApprovalsSnapshot(payload: ApprovalsListPayload): void;
  upsertApproval(request: PromotionApprovalRequest): void;
  setApprovalsStatus(status: RequestStatus, error?: string | null): void;
  clear(): void;

  requestList(transport: TransportHandle | null): Promise<boolean>;
  updateTrust(
    transport: TransportHandle | null,
    extensionId: string,
    tier: ExtensionTier,
  ): Promise<boolean>;
  listApprovals(transport: TransportHandle | null): Promise<boolean>;
  requestPromotion(
    transport: TransportHandle | null,
    extensionId: string,
    targetTier: PromotionTier,
  ): Promise<boolean>;
  approvePromotion(
    transport: TransportHandle | null,
    requestId: string,
  ): Promise<boolean>;
}

function errMessage(
  ack: { error?: { message?: string } | null },
  fallback: string,
): string {
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

  approvals: new Map(),
  approvalsOrder: [],
  approvalsStatus: 'idle',
  approvalsError: null,

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

  setApprovalsSnapshot(payload) {
    const approvals = new Map<string, PromotionApprovalRequest>();
    const approvalsOrder: string[] = [];
    for (const r of payload.requests) {
      approvals.set(r.request_id, r);
      approvalsOrder.push(r.request_id);
    }
    set({
      approvals,
      approvalsOrder,
      approvalsStatus: 'ready',
      approvalsError: null,
    });
  },

  upsertApproval(request) {
    set((s) => {
      const approvals = new Map(s.approvals);
      const approvalsOrder = approvals.has(request.request_id)
        ? s.approvalsOrder
        : [...s.approvalsOrder, request.request_id];
      approvals.set(request.request_id, request);
      return { approvals, approvalsOrder };
    });
  },

  setApprovalsStatus(status, error = null) {
    set({ approvalsStatus: status, approvalsError: error });
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
      approvals: new Map(),
      approvalsOrder: [],
      approvalsStatus: 'idle',
      approvalsError: null,
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
      get().setStatus(
        'error',
        errMessage(ack, 'extensions.update_trust failed'),
      );
      return false;
    }
    return true;
  },

  async listApprovals(transport) {
    if (!transport) {
      get().setApprovalsStatus('error', 'no transport');
      return false;
    }
    const sessionId = useSession.getState().sessionId;
    if (!sessionId) {
      get().setApprovalsStatus('error', 'no active session');
      return false;
    }
    get().setApprovalsStatus('loading');
    const ack = await transport.send(
      sessionId,
      'extensions.list_approvals',
      {},
    );
    if (!ack.ok) {
      get().setApprovalsStatus(
        'error',
        errMessage(ack, 'extensions.list_approvals failed'),
      );
      return false;
    }
    // Status flips to 'ready' when extensions.approvals_list_response lands.
    return true;
  },

  async requestPromotion(transport, extensionId, targetTier) {
    if (!transport) {
      get().setApprovalsStatus('error', 'no transport');
      return false;
    }
    const sessionId = useSession.getState().sessionId;
    if (!sessionId) {
      get().setApprovalsStatus('error', 'no active session');
      return false;
    }
    const ack = await transport.send(
      sessionId,
      'extensions.request_promotion',
      { extension_id: extensionId, target_tier: targetTier },
    );
    if (!ack.ok) {
      get().setApprovalsStatus(
        'error',
        errMessage(ack, 'extensions.request_promotion failed'),
      );
      return false;
    }
    return true;
  },

  async approvePromotion(transport, requestId) {
    if (!transport) {
      get().setApprovalsStatus('error', 'no transport');
      return false;
    }
    const sessionId = useSession.getState().sessionId;
    if (!sessionId) {
      get().setApprovalsStatus('error', 'no active session');
      return false;
    }
    const ack = await transport.send(
      sessionId,
      'extensions.approve_promotion',
      { request_id: requestId },
    );
    if (!ack.ok) {
      get().setApprovalsStatus(
        'error',
        errMessage(ack, 'extensions.approve_promotion failed'),
      );
      return false;
    }
    return true;
  },
}));
