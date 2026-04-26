// Review store: files in a pending changeset + lazy diff bodies.
//
// Files arrive via `changeset.updated`; diff bodies are fetched lazily via
// `review.open_file` when the user clicks a row.

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

interface ReviewSlice {
  files: ReviewFile[];
  diffs: Map<string, DiffBody>;
  pendingFetch: Set<string>;
  setFiles(files: ReviewFile[]): void;
  setDiff(body: DiffBody): void;
  removeFile(path: string): void;
  clear(): void;
  markFetching(path: string): void;
  isFetching(path: string): boolean;
}

export const useReview = create<ReviewSlice>((set, get) => ({
  files: [],
  diffs: new Map(),
  pendingFetch: new Set(),

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
      return {
        files: s.files.filter((f) => f.path !== path),
        diffs,
      };
    });
  },

  clear() {
    set({ files: [], diffs: new Map(), pendingFetch: new Set() });
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
}));
