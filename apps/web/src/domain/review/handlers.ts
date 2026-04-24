// Wire transport events → review store.

import { useReview, type ReviewFile } from '../../stores/review';
import type { TransportHandle } from '../../transport';

interface ChangesetUpdatedPayload {
  files: Array<{
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
  }>;
}

interface DiffChunkPayload {
  path: string;
  unified: string;
  truncated?: boolean;
}

interface FileRevertedPayload {
  path: string;
}

function asStatus(raw: string): ReviewFile['status'] {
  if (raw === 'added' || raw === 'modified' || raw === 'deleted' || raw === 'renamed') return raw;
  return 'modified';
}

export function registerReviewHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('changeset.updated', (ev) => {
      const p = ev.payload as ChangesetUpdatedPayload | null;
      if (!p?.files) return;
      useReview.getState().setFiles(
        p.files.map((f) => ({
          path: f.path,
          status: asStatus(f.status),
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
        })),
      );
    }),
  );

  offs.push(
    transport.on('changeset.file.diff_chunk', (ev) => {
      const p = ev.payload as DiffChunkPayload | null;
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
      const p = ev.payload as FileRevertedPayload | null;
      if (!p?.path) return;
      useReview.getState().removeFile(p.path);
    }),
  );

  return () => offs.forEach((off) => off());
}
