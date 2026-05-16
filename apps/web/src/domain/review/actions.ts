import {
  useReview,
  type ReviewActionFeedback,
  type ReviewActionStatus,
  type ReviewFile,
} from '../../stores/review';
import type { TransportHandle } from '../../transport';

// Phase 1 (Sprint A) keeps the public types re-exported from this module so
// existing imports continue to compile. The single source of truth for
// status state, however, is the review store — outbound helpers below
// write through to it on each transition (sending → requested / failed).
export { type ReviewActionFeedback, type ReviewActionStatus };

export interface ReviewHunkSummary {
  id: string;
  header: string;
  startLine: number;
  additions: number;
  deletions: number;
}

export type ReviewRiskLabel =
  | 'docs'
  | 'config'
  | 'security-sensitive'
  | 'dependency'
  | 'generated'
  | 'code';

export function reviewFileActionKey(path: string): string {
  return `file:${path}`;
}

export function reviewHunkActionKey(
  path: string,
  hunkId: string,
  action: string,
): string {
  return `hunk:${path}:${hunkId}:${action}`;
}

export function classifyReviewFile(
  file: Pick<ReviewFile, 'path' | 'status' | 'additions' | 'deletions'>,
): ReviewRiskLabel[] {
  const path = file.path.toLowerCase();
  const labels: ReviewRiskLabel[] = [];
  if (path.endsWith('.md') || path.includes('/docs/')) labels.push('docs');
  if (
    path.endsWith('.lock') ||
    path.includes('package.json') ||
    path.includes('pnpm-lock') ||
    path.includes('cargo.toml')
  )
    labels.push('dependency');
  if (
    path.includes('auth') ||
    path.includes('security') ||
    path.includes('permission') ||
    path.includes('token') ||
    path.includes('secret')
  )
    labels.push('security-sensitive');
  if (
    path.includes('generated') ||
    path.includes('/gen/') ||
    path.includes('__generated__')
  )
    labels.push('generated');
  if (
    path.endsWith('.json') ||
    path.endsWith('.yaml') ||
    path.endsWith('.yml') ||
    path.endsWith('.toml') ||
    path.endsWith('.config.ts')
  )
    labels.push('config');
  if (labels.length === 0) labels.push('code');
  return labels;
}

export function parseUnifiedHunks(
  unified: string | null | undefined,
): ReviewHunkSummary[] {
  if (!unified) return [];
  const lines = unified.split('\n');
  const hunks: ReviewHunkSummary[] = [];
  let current: ReviewHunkSummary | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = {
        id: `hunk-${hunks.length + 1}`,
        header: line,
        startLine: i + 1,
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  if (current) hunks.push(current);
  return hunks;
}

interface ReviewActionCopy {
  sending: string;
  requested: string;
  failed: string;
}

async function dispatchReviewAction<P extends { session_id?: string }>(
  transport: TransportHandle,
  sessionId: string,
  type: string,
  payload: P,
  key: string,
  copy: ReviewActionCopy,
): Promise<void> {
  useReview.getState().setActionStatus({
    key,
    status: 'sending',
    message: copy.sending,
  });
  try {
    await transport.send(sessionId, type, payload);
    useReview.getState().setActionStatus({
      key,
      status: 'requested',
      message: copy.requested,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : copy.failed;
    useReview.getState().setActionStatus({
      key,
      status: 'failed',
      message,
    });
    throw err;
  }
}

export async function requestReviewFileRevert(
  transport: TransportHandle,
  sessionId: string,
  path: string,
): Promise<void> {
  await dispatchReviewAction(
    transport,
    sessionId,
    'review.revert_file',
    { session_id: sessionId, path },
    reviewFileActionKey(path),
    {
      sending: 'Sending file revert request...',
      requested: 'File revert request sent to agent.',
      failed: 'Failed to send file revert request.',
    },
  );
}

export async function requestReviewHunkRevision(
  transport: TransportHandle,
  sessionId: string,
  path: string,
  hunk: ReviewHunkSummary,
): Promise<void> {
  await dispatchReviewAction(
    transport,
    sessionId,
    'review.hunk.action.request',
    {
      session_id: sessionId,
      path,
      hunk_id: hunk.id,
      hunk_header: hunk.header,
      action: 'request_rework',
    },
    reviewHunkActionKey(path, hunk.id, 'request_rework'),
    {
      sending: 'Sending hunk revision request...',
      requested: 'Hunk revision request sent to agent.',
      failed: 'Failed to send hunk revision request.',
    },
  );
}

export async function requestReviewHunkRevert(
  transport: TransportHandle,
  sessionId: string,
  path: string,
  hunk: ReviewHunkSummary,
): Promise<void> {
  await dispatchReviewAction(
    transport,
    sessionId,
    'review.hunk.action.request',
    {
      session_id: sessionId,
      path,
      hunk_id: hunk.id,
      hunk_header: hunk.header,
      action: 'revert_hunk',
    },
    reviewHunkActionKey(path, hunk.id, 'revert_hunk'),
    {
      sending: 'Sending hunk revert request...',
      requested: 'Hunk revert request sent to agent.',
      failed: 'Failed to send hunk revert request.',
    },
  );
}
