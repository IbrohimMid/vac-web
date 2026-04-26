// Wire transport events → review store.

import { useReview, type ReviewFile } from '../../stores/review';
import type { TransportHandle } from '../../transport';

function asStatus(raw: string): ReviewFile['status'] {
  if (raw === 'added' || raw === 'modified' || raw === 'deleted' || raw === 'renamed') return raw;
  return 'modified';
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function countLines(raw: string | null | undefined): number {
  if (!raw) return 0;
  const lines = raw.split(/\r?\n/);
  return lines.length === 1 && lines[0] === '' ? 0 : lines.length;
}

function mergeStatus(a: ReviewFile['status'], b: ReviewFile['status']): ReviewFile['status'] {
  const order: ReviewFile['status'][] = ['modified', 'added', 'deleted', 'renamed'];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

function deriveFilesFromReviewPayload(payload: Record<string, unknown>): ReviewFile[] {
  if (Array.isArray(payload.files)) {
    return payload.files
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
      .filter((f) => typeof f.path === 'string')
      .map((f) => ({
        path: f.path as string,
        status: asStatus(typeof f.status === 'string' ? f.status : 'modified'),
        additions: typeof f.additions === 'number' ? f.additions : 0,
        deletions: typeof f.deletions === 'number' ? f.deletions : 0,
        ...(typeof f.tool_call_id === 'string' && { toolCallId: f.tool_call_id }),
        ...(typeof f.approved_by_approval_id === 'string' && { approvedByApprovalId: f.approved_by_approval_id }),
        ...(typeof f.source_event_type === 'string' && { sourceEventType: f.source_event_type }),
      }));
  }

  const toolCallId = asString(payload.tool_call_id) ?? asString(payload.toolCallId);
  const approvalId = asString(payload.approved_by_approval_id) ?? asString(payload.approvedByApprovalId);
  const sourceEventType = asString(payload.source_event_type) ?? asString(payload.sourceEventType) ?? 'review.changeset_updated';
  const files = new Map<string, ReviewFile>();
  const diffs = Array.isArray(payload.diffs) ? payload.diffs : [];
  for (const diff of diffs) {
    const d = asRecord(diff);
    const path = asString(d.path);
    if (!path) continue;
    const newText = asString(d.new_text) ?? asString(d.newText);
    const oldText = asString(d.old_text) ?? asString(d.oldText);
    const nextStatus =
      oldText == null && newText != null
        ? 'added'
        : newText == null && oldText != null
          ? 'deleted'
          : 'modified';
    const current = files.get(path) ?? {
      path,
      status: nextStatus,
      additions: 0,
      deletions: 0,
      ...(toolCallId && { toolCallId }),
      ...(approvalId && { approvedByApprovalId: approvalId }),
      sourceEventType,
    };
    const oldLines = countLines(oldText);
    const newLines = countLines(newText);
    current.status = mergeStatus(current.status, nextStatus);
    current.additions += Math.max(newLines - oldLines, 0);
    current.deletions += Math.max(oldLines - newLines, 0);
    files.set(path, current);
  }

  if (files.size > 0) return [...files.values()];

  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  const derived = locations
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
    .map((loc) => asString(loc.path))
    .filter((path): path is string => Boolean(path))
    .map((path) => ({
      path,
      status: 'modified' as const,
      additions: 0,
      deletions: 0,
      ...(toolCallId && { toolCallId }),
      ...(approvalId && { approvedByApprovalId: approvalId }),
      sourceEventType,
    }));
  return derived;
}

export function registerReviewHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('review.changeset_updated', (ev) => {
      const p = asRecord(ev.payload);
      const files = deriveFilesFromReviewPayload(p);
      if (files.length === 0) return;
      useReview.getState().setFiles(files);
    }),
  );

  offs.push(
    transport.on('changeset.updated', (ev) => {
      const p = asRecord(ev.payload);
      if (!Array.isArray(p.files)) return;
      useReview.getState().setFiles(
        p.files
          .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
          .filter((f) => typeof f.path === 'string')
          .map((f) => ({
            path: f.path as string,
            status: asStatus(typeof f.status === 'string' ? f.status : 'modified'),
            additions: typeof f.additions === 'number' ? f.additions : 0,
            deletions: typeof f.deletions === 'number' ? f.deletions : 0,
            ...(typeof f.tool_call_id === 'string' && { toolCallId: f.tool_call_id }),
            ...(typeof f.approved_by_approval_id === 'string' && { approvedByApprovalId: f.approved_by_approval_id }),
            ...(typeof f.source_event_type === 'string' && { sourceEventType: f.source_event_type }),
          })),
      );
    }),
  );

  offs.push(
    transport.on('changeset.file.diff_chunk', (ev) => {
      const p = ev.payload as { path?: string; unified?: string; truncated?: boolean } | null;
      if (!p?.path || typeof p.unified !== 'string') return;
      useReview.getState().setDiff({
        path: p.path,
        unified: p.unified,
        truncated: Boolean(p.truncated),
      });
    }),
  );

  offs.push(
    transport.on('changeset.file.reverted', (ev) => {
      const p = ev.payload as { path?: string } | null;
      if (!p?.path) return;
      useReview.getState().removeFile(p.path);
    }),
  );

  return () => offs.forEach((off) => off());
}
