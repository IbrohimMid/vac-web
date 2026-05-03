// Wire transport events → review store.
//
// Slice 05 (wiring.review_taxonomy): the bridge canonicalizes on `review.*`
// events. Legacy `changeset.*` listeners are removed; the mock-engine has
// been updated to emit `review.changeset_updated` and `review.file_diff_chunk`
// to match. There is exactly one canonical event taxonomy here.

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

function filesFromArray(rawFiles: unknown, fallbackToolCallId: string | null, fallbackApprovalId: string | null, fallbackSourceEvent: string): ReviewFile[] {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
    .filter((f) => typeof f.path === 'string')
    .map((f) => ({
      path: f.path as string,
      status: asStatus(typeof f.status === 'string' ? f.status : 'modified'),
      additions: typeof f.additions === 'number' ? f.additions : 0,
      deletions: typeof f.deletions === 'number' ? f.deletions : 0,
      ...(typeof f.tool_call_id === 'string'
        ? { toolCallId: f.tool_call_id }
        : fallbackToolCallId
          ? { toolCallId: fallbackToolCallId }
          : {}),
      ...(typeof f.approved_by_approval_id === 'string'
        ? { approvedByApprovalId: f.approved_by_approval_id }
        : fallbackApprovalId
          ? { approvedByApprovalId: fallbackApprovalId }
          : {}),
      sourceEventType: typeof f.source_event_type === 'string' ? f.source_event_type : fallbackSourceEvent,
    }));
}

function deriveFilesFromReviewPayload(payload: Record<string, unknown>): ReviewFile[] {
  const toolCallId = asString(payload.tool_call_id) ?? asString(payload.toolCallId);
  const approvalId = asString(payload.approved_by_approval_id) ?? asString(payload.approvedByApprovalId);
  const sourceEventType = asString(payload.source_event_type) ?? asString(payload.sourceEventType) ?? 'review.changeset_updated';

  const fromArray = filesFromArray(payload.files, toolCallId, approvalId, sourceEventType);
  if (fromArray.length > 0) return fromArray;
  // Empty-array payload signals "no changes" (e.g., revert_all). Return [] so the store clears.
  if (Array.isArray(payload.files)) return [];

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

  // Canonical review.changeset_updated: full file list, may also signal a single
  // reverted path via reverted_path. Empty files: [] means "no changes" (revert_all).
  offs.push(
    transport.on('review.changeset_updated', (ev) => {
      const p = asRecord(ev.payload);
      const revertedPath = asString(p.reverted_path) ?? asString(p.revertedPath);
      if (revertedPath && !Array.isArray(p.files)) {
        useReview.getState().removeFile(revertedPath);
        return;
      }
      const files = deriveFilesFromReviewPayload(p);
      // setFiles also accepts [] as a clear; trust the canonical event.
      useReview.getState().setFiles(files);
      if (revertedPath) {
        useReview.getState().removeFile(revertedPath);
      }
    }),
  );

  // Canonical review.file_diff_chunk: streaming diff body for a single file,
  // fetched lazily after `review.open_file`.
  offs.push(
    transport.on('review.file_diff_chunk', (ev) => {
      const p = ev.payload as { path?: string; unified?: string; truncated?: boolean } | null;
      if (!p?.path || typeof p.unified !== 'string') return;
      useReview.getState().setDiff({
        path: p.path,
        unified: p.unified,
        truncated: Boolean(p.truncated),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
