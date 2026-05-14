import type { ReviewFile } from '../../stores/review';
import type { TransportHandle } from '../../transport';

export interface ReviewHunkSummary {
  id: string;
  header: string;
  startLine: number;
  additions: number;
  deletions: number;
}

export type ReviewRiskLabel = 'docs' | 'config' | 'security-sensitive' | 'dependency' | 'generated' | 'code';

export function classifyReviewFile(file: Pick<ReviewFile, 'path' | 'status' | 'additions' | 'deletions'>): ReviewRiskLabel[] {
  const path = file.path.toLowerCase();
  const labels: ReviewRiskLabel[] = [];
  if (path.endsWith('.md') || path.includes('/docs/')) labels.push('docs');
  if (path.endsWith('.lock') || path.includes('package.json') || path.includes('pnpm-lock') || path.includes('cargo.toml')) labels.push('dependency');
  if (path.includes('auth') || path.includes('security') || path.includes('permission') || path.includes('token') || path.includes('secret')) labels.push('security-sensitive');
  if (path.includes('generated') || path.includes('/gen/') || path.includes('__generated__')) labels.push('generated');
  if (path.endsWith('.json') || path.endsWith('.yaml') || path.endsWith('.yml') || path.endsWith('.toml') || path.endsWith('.config.ts')) labels.push('config');
  if (labels.length === 0) labels.push('code');
  return labels;
}

export function parseUnifiedHunks(unified: string | null | undefined): ReviewHunkSummary[] {
  if (!unified) return [];
  const lines = unified.split('\n');
  const hunks: ReviewHunkSummary[] = [];
  let current: ReviewHunkSummary | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { id: `hunk-${hunks.length + 1}`, header: line, startLine: i + 1, additions: 0, deletions: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  if (current) hunks.push(current);
  return hunks;
}

async function sendReviewEvent<P extends { session_id?: string }>(
  transport: TransportHandle,
  sessionId: string,
  type: string,
  payload: P,
): Promise<void> {
  await transport.send(sessionId, type, payload);
}

export async function requestReviewFileRevert(transport: TransportHandle, sessionId: string, path: string): Promise<void> {
  await sendReviewEvent(transport, sessionId, 'review.revert_file', { session_id: sessionId, path });
}

export async function requestReviewHunkRevision(
  transport: TransportHandle,
  sessionId: string,
  path: string,
  hunk: ReviewHunkSummary,
): Promise<void> {
  await sendReviewEvent(transport, sessionId, 'review.hunk.action.request', {
    session_id: sessionId,
    path,
    hunk_id: hunk.id,
    hunk_header: hunk.header,
    action: 'request_rework',
  });
}

export async function requestReviewHunkRevert(
  transport: TransportHandle,
  sessionId: string,
  path: string,
  hunk: ReviewHunkSummary,
): Promise<void> {
  await sendReviewEvent(transport, sessionId, 'review.hunk.action.request', {
    session_id: sessionId,
    path,
    hunk_id: hunk.id,
    hunk_header: hunk.header,
    action: 'revert_hunk',
  });
}
