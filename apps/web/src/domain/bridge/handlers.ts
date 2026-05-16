// Wire transport events -> bridge mutation inbox.
//
// Phase B1 (Sprint B): subscribe to `bridge.mutation.requested` and stage the
// intent into the mutations store. Approve / reject commands and the apply /
// failed lifecycle land in Phase B2 and B3 respectively.
//
// The handler is defensive on purpose:
//   - Payloads missing `request_id` are dropped (a malformed mock cannot
//     poison the inbox).
//   - Unknown `kind` values are coerced to 'unknown' rather than trusted, so a
//     future bridge revision cannot silently introduce a new mutation kind
//     that bypasses the inbox classification.
//   - Both snake_case (canonical bridge taxonomy) and camelCase aliases are
//     accepted so mock-engine fixtures and Rust translator output can use the
//     same handler without bespoke shims.

import {
  useMutations,
  MUTATION_KINDS,
  MUTATION_STATUSES,
  type MutationIntent,
  type MutationKind,
  type MutationStatus,
} from '../../stores/mutations';
import { useAudit } from '../../stores/audit';
import type { TransportHandle } from '../../transport';

function logBridgeAudit(
  kind: string,
  requestId: string,
  summary: string,
  status: MutationStatus,
  detail?: string,
): void {
  useAudit.getState().append({
    source: 'bridge', kind, requestId, summary, status,
    ...(detail ? { detail } : {}),
  });
}

function asStatus(raw: string | null): MutationStatus | null {
  return raw && (MUTATION_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as MutationStatus)
    : null;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function asKind(raw: string | null): MutationKind {
  return raw && (MUTATION_KINDS as ReadonlyArray<string>).includes(raw)
    ? (raw as MutationKind)
    : 'unknown';
}

export function registerBridgeHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('bridge.mutation.requested', (ev) => {
      const p = asRecord(ev.payload);
      const requestId = asString(p.request_id) ?? asString(p.requestId);
      if (!requestId) return;
      const summary = asString(p.summary) ?? '(no summary)';
      const intent: MutationIntent = {
        requestId,
        kind: asKind(asString(p.kind)),
        summary,
        ...(asString(p.rationale) ? { rationale: asString(p.rationale) as string } : {}),
        ...(asString(p.target_path) ?? asString(p.targetPath)
          ? { targetPath: (asString(p.target_path) ?? asString(p.targetPath)) as string }
          : {}),
        ...(asString(p.diff_preview) ?? asString(p.diffPreview)
          ? { diffPreview: (asString(p.diff_preview) ?? asString(p.diffPreview)) as string }
          : {}),
        ...(asString(p.originating_task_id) ?? asString(p.originatingTaskId)
          ? {
              originatingTaskId:
                (asString(p.originating_task_id) ?? asString(p.originatingTaskId)) as string,
            }
          : {}),
        ...(asString(p.originating_session_id) ??
        asString(p.originatingSessionId) ??
        asString((ev as { session_id?: unknown }).session_id)
          ? {
              originatingSessionId: (asString(p.originating_session_id) ??
                asString(p.originatingSessionId) ??
                asString((ev as { session_id?: unknown }).session_id)) as string,
            }
          : {}),
        receivedAt: Date.now(),
        status: 'pending',
        sourceEventType: 'bridge.mutation.requested',
      };
      useMutations.getState().upsert(intent);
      logBridgeAudit(
        'bridge.mutation.requested',
        intent.requestId,
        `Bridge requested ${intent.kind}: ${intent.summary}`,
        'pending',
        intent.targetPath,
      );
    }),
  );

  // B3 apply lifecycle: terminal `applied`, terminal `failed`, generic
  // `updated` (status + message). All are idempotent — if the requestId is
  // unknown the event is dropped so a stray bridge frame cannot poison the
  // store.
  offs.push(
    transport.on('bridge.mutation.applied', (ev) => {
      const p = asRecord(ev.payload);
      const requestId = asString(p.request_id) ?? asString(p.requestId);
      if (!requestId) return;
      const appliedAt = asString(p.applied_at) ?? asString(p.appliedAt);
      const path = asString(p.applied_path) ?? asString(p.appliedPath);
      const parts = ['Bridge applied'];
      if (path) parts.push(`→ ${path}`);
      if (appliedAt) parts.push(`@ ${appliedAt}`);
      const msg = parts.join(' ');
      useMutations.getState().setStatus(requestId, 'applied', msg);
      logBridgeAudit('bridge.mutation.applied', requestId, msg, 'applied', path ?? undefined);
    }),
  );
  offs.push(
    transport.on('bridge.mutation.failed', (ev) => {
      const p = asRecord(ev.payload);
      const requestId = asString(p.request_id) ?? asString(p.requestId);
      if (!requestId) return;
      const reason = asString(p.reason) ?? asString(p.message) ?? 'unknown error';
      const code = asString(p.error_code) ?? asString(p.errorCode);
      const message = code ? `Bridge apply failed [${code}]: ${reason}` : `Bridge apply failed: ${reason}`;
      useMutations.getState().setStatus(requestId, 'failed', message);
      logBridgeAudit('bridge.mutation.failed', requestId, message, 'failed', reason);
    }),
  );
  offs.push(
    transport.on('bridge.mutation.updated', (ev) => {
      const p = asRecord(ev.payload);
      const requestId = asString(p.request_id) ?? asString(p.requestId);
      if (!requestId) return;
      const status = asStatus(asString(p.status));
      if (!status) return;
      const message = asString(p.message);
      useMutations.getState().setStatus(requestId, status, message ?? undefined);
      logBridgeAudit(
        'bridge.mutation.updated',
        requestId,
        message ?? `Bridge transitioned to ${status}`,
        status,
        message ?? undefined,
      );
    }),
  );

  return () => offs.forEach((off) => off());
}
