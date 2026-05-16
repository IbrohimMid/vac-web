// Review store: files in a pending changeset + lazy diff bodies + agent-mediated
// review action status.
//
// Files arrive via the canonical `review.changeset_updated` event; diff bodies
// arrive via `review.file_diff_chunk` after `review.open_file` is invoked.
// Review action status (Phase 1) arrives via `review.file.action.updated` and
// `review.hunk.action.updated`, plus optimistic transitions written by the
// outbound helpers in domain/review/actions.ts. This single store is the
// source of truth for every surface that renders review action feedback
// (ReviewQueue, DiffViewer, TaskBoard, ...).
//
// Slice 05 (wiring.review_taxonomy) removed the legacy `changeset.*` taxonomy.

import { create } from 'zustand';

export interface ReviewFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  toolCallId?: string;
  approvedByApprovalId?: string | null;
  sourceEventType?: string;
}

export interface DiffBody {
  path: string;
  unified: string;
  truncated: boolean;
}

// Phase 1: agent-mediated review action status.
//
// Status transitions:
//   sending   — button clicked, transport.send is in flight (optimistic)
//   requested — transport.send resolved; agent has received the request
//   failed    — transport.send rejected OR bridge replied with error
//   completed — bridge confirmed the action finished (reserved for Sprint B)
//   idle      — cleared / never set
export type ReviewActionStatus =
  | 'idle'
  | 'sending'
  | 'requested'
  | 'failed'
  | 'completed';

export interface ReviewActionFeedback {
  key: string;
  status: ReviewActionStatus;
  message: string;
  updatedAt?: number;
}

interface ReviewSlice {
  files: ReviewFile[];
  diffs: Map<string, DiffBody>;
  pendingFetch: Set<string>;
  actionStatus: Record<string, ReviewActionFeedback>;
  setFiles(files: ReviewFile[]): void;
  setDiff(body: DiffBody): void;
  removeFile(path: string): void;
  clear(): void;
  markFetching(path: string): void;
  isFetching(path: string): boolean;
  setActionStatus(feedback: ReviewActionFeedback): void;
  clearActionStatus(key: string): void;
  clearAllActionStatus(): void;
}

export const useReview = create<ReviewSlice>((set, get) => ({
  files: [],
  diffs: new Map(),
  pendingFetch: new Set(),
  actionStatus: {},

  setFiles(files) {
    set({ files });
  },

  setDiff(body) {
    set((s) => {
      const diffs = new Map(s.diffs);
      diffs.set(body.path, body);
      const pendingFetch = new Set(s.pendingFetch);
      pendingFetch.delete(body.path);
      return { diffs, pendingFetch };
    });
  },

  removeFile(path) {
    set((s) => {
      const diffs = new Map(s.diffs);
      diffs.delete(path);
      // Drop any action feedback keyed to this file path so reverts do not
      // leave stale 'requested' chips behind once the file disappears.
      const actionStatus: Record<string, ReviewActionFeedback> = {};
      for (const [key, feedback] of Object.entries(s.actionStatus)) {
        if (key !== `file:${path}` && !key.startsWith(`hunk:${path}:`)) {
          actionStatus[key] = feedback;
        }
      }
      return {
        files: s.files.filter((f) => f.path !== path),
        diffs,
        actionStatus,
      };
    });
  },

  clear() {
    set({
      files: [],
      diffs: new Map(),
      pendingFetch: new Set(),
      actionStatus: {},
    });
  },

  markFetching(path) {
    set((s) => {
      const pendingFetch = new Set(s.pendingFetch);
      pendingFetch.add(path);
      return { pendingFetch };
    });
  },

  isFetching(path) {
    return get().pendingFetch.has(path);
  },

  setActionStatus(feedback) {
    set((s) => ({
      actionStatus: {
        ...s.actionStatus,
        [feedback.key]: {
          ...feedback,
          updatedAt: feedback.updatedAt ?? Date.now(),
        },
      },
    }));
  },

  clearActionStatus(key) {
    set((s) => {
      if (!(key in s.actionStatus)) return s;
      const next = { ...s.actionStatus };
      delete next[key];
      return { actionStatus: next };
    });
  },

  clearAllActionStatus() {
    set({ actionStatus: {} });
  },
}));
