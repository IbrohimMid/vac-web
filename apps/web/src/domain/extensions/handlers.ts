// Wire extensions.* transport events into the extensions store.
// Producer: apps/local-bridge/src/extensions/handlers.rs.

import { useExtensions } from '../../stores/extensions';
import type { TransportHandle } from '../../transport';
import {
  isApprovalStatus,
  isExtensionSource,
  isExtensionTier,
  isPromotionTier,
  isTrustDecision,
  type ExtensionEntry,
  type ExtensionsListPayload,
  type ExtensionsUpdatedPayload,
  type PromotionApprovalRequest,
} from './types';

function asEntry(raw: unknown): ExtensionEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (!isExtensionTier(r.tier)) return null;
  if (!isExtensionSource(r.source)) return null;
  if (!isTrustDecision(r.decision)) return null;
  const publisher = typeof r.publisher === 'string' ? r.publisher : null;
  return {
    id: r.id,
    tier: r.tier,
    source: r.source,
    publisher,
    decision: r.decision,
  };
}

function asApprovalRequest(raw: unknown): PromotionApprovalRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.request_id !== 'string' || !r.request_id) return null;
  if (typeof r.extension_id !== 'string' || !r.extension_id) return null;
  if (!isPromotionTier(r.requested_tier)) return null;
  if (typeof r.requested_by_session_id !== 'string') return null;
  if (typeof r.requested_by_profile_id !== 'string') return null;
  if (typeof r.created_at !== 'string') return null;
  if (!isApprovalStatus(r.status)) return null;
  return {
    request_id: r.request_id,
    extension_id: r.extension_id,
    requested_tier: r.requested_tier,
    requested_by_session_id: r.requested_by_session_id,
    requested_by_profile_id: r.requested_by_profile_id,
    created_at: r.created_at,
    status: r.status,
    decided_at: typeof r.decided_at === 'string' ? r.decided_at : null,
    decided_by_session_id:
      typeof r.decided_by_session_id === 'string'
        ? r.decided_by_session_id
        : null,
    decided_by_profile_id:
      typeof r.decided_by_profile_id === 'string'
        ? r.decided_by_profile_id
        : null,
  };
}

export function registerExtensionsHandlers(
  transport: TransportHandle,
): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('extensions.list_response', (ev) => {
      const p = ev.payload as Partial<ExtensionsListPayload> | null;
      if (!p) return;
      const entries = Array.isArray(p.entries)
        ? p.entries
            .map(asEntry)
            .filter((e): e is ExtensionEntry => e !== null)
        : [];
      useExtensions.getState().setSnapshot({
        version: typeof p.version === 'number' ? p.version : 0,
        allow_unsigned: p.allow_unsigned === true,
        publishers: Array.isArray(p.publishers)
          ? p.publishers.filter((x): x is string => typeof x === 'string')
          : [],
        entries,
      });
    }),
  );

  offs.push(
    transport.on('extensions.updated', (ev) => {
      const p = ev.payload as Partial<ExtensionsUpdatedPayload> | null;
      const entry = p ? asEntry(p.entry) : null;
      if (!entry) return;
      useExtensions.getState().upsertEntry(entry);
    }),
  );

  // Promotion approvals (Slice #6 / ADR-0004).

  offs.push(
    transport.on('extensions.approvals_list_response', (ev) => {
      const p = ev.payload as { requests?: unknown } | null;
      const requests = p && Array.isArray(p.requests)
        ? p.requests
            .map(asApprovalRequest)
            .filter((r): r is PromotionApprovalRequest => r !== null)
        : [];
      useExtensions.getState().setApprovalsSnapshot({ requests });
    }),
  );

  for (const eventType of [
    'extensions.promotion_requested',
    'extensions.promotion_approved',
    'extensions.promotion_denied',
  ] as const) {
    offs.push(
      transport.on(eventType, (ev) => {
        const p = ev.payload as { request?: unknown } | null;
        const request = p ? asApprovalRequest(p.request) : null;
        if (!request) return;
        useExtensions.getState().upsertApproval(request);
      }),
    );
  }

  return () => offs.forEach((off) => off());
}
