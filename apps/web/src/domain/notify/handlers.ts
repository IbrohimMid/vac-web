// Wire notify/pulse/activity events from transport → stores.

import { useActivity } from '../../stores/activity';
import { useNotify, type Lane, type NotifyEntry } from '../../stores/notify';
import { useSystemPulse, type Facet } from '../../stores/systemPulse';
import type { Severity } from '../../components/SeverityIcon';
import type { TransportHandle } from '../../transport';

function asSeverity(s: unknown): Severity {
  return s === 'ok' || s === 'info' || s === 'warn' || s === 'error' ? s : 'info';
}

function asLane(l: unknown): Lane {
  return l === 'transient' || l === 'persistent' || l === 'sticky' ? l : 'transient';
}

export function registerNotifyHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('notify.event', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p?.id) return;
      const entry: NotifyEntry = {
        id: String(p.id),
        lane: asLane(p.lane),
        severity: asSeverity(p.severity),
        subsystem: String(p.subsystem ?? 'unknown'),
        title: String(p.title ?? ''),
        message: String(p.message ?? ''),
        ts: String(p.ts ?? new Date().toISOString()),
      };
      if (typeof p.action_id === 'string') entry.actionId = p.action_id;
      if (typeof p.correlation_id === 'string') entry.correlationId = p.correlation_id;
      useNotify.getState().receive(entry);
    }),
  );

  offs.push(
    transport.on('system_pulse.updated', (ev) => {
      const p = ev.payload as { facets?: Array<Record<string, unknown>> } | null;
      if (!p?.facets) return;
      const facets: Facet[] = p.facets.map((f) => ({
        kind: String(f.kind ?? ''),
        label: String(f.label ?? ''),
        severity: asSeverity(f.severity),
      }));
      useSystemPulse.getState().setFacets(facets);
    }),
  );

  offs.push(
    transport.on('activity.appended', (ev) => {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p?.id) return;
      useActivity.getState().append({
        id: String(p.id),
        ts: String(p.ts ?? new Date().toISOString()),
        subsystem: String(p.subsystem ?? 'unknown'),
        severity: asSeverity(p.severity),
        summary: String(p.summary ?? ''),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
