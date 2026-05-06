// Wire extensions.* transport events into the extensions store.
// Producer: apps/local-bridge/src/extensions/handlers.rs.

import { useExtensions } from '../../stores/extensions';
import type { TransportHandle } from '../../transport';
import {
  isExtensionSource,
  isExtensionTier,
  isTrustDecision,
  type ExtensionEntry,
  type ExtensionsListPayload,
  type ExtensionsUpdatedPayload,
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

export function registerExtensionsHandlers(transport: TransportHandle): () => void {
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

  return () => offs.forEach((off) => off());
}
