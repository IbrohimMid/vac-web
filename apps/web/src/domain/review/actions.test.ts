import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyReviewFile,
  parseUnifiedHunks,
  requestReviewFileRevert,
  requestReviewHunkRevert,
  requestReviewHunkRevision,
  reviewFileActionKey,
  reviewHunkActionKey,
} from './actions';
import { useReview } from '../../stores/review';
import type { TransportHandle } from '../../transport';

function fakeTransport(send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({} as never)): TransportHandle {
  return { send, on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

describe('review actions helpers', () => {
  beforeEach(() => {
    useReview.setState({
      files: [],
      diffs: new Map(),
      pendingFetch: new Set(),
      actionStatus: {},
    });
  });

  it('parses unified diff hunks and counts additions/deletions', () => {
    const hunks = parseUnifiedHunks('--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n@@ -9 +9 @@\n-a\n+b');
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ id: 'hunk-1', additions: 1, deletions: 1 });
    expect(hunks[1]!.header).toBe('@@ -9 +9 @@');
  });

  it('returns no hunks for empty diff', () => {
    expect(parseUnifiedHunks(null)).toEqual([]);
  });

  it('classifies risk labels from path', () => {
    expect(classifyReviewFile({ path: 'docs/readme.md', status: 'modified', additions: 1, deletions: 0 })).toContain('docs');
    expect(classifyReviewFile({ path: 'src/auth/token.ts', status: 'modified', additions: 1, deletions: 0 })).toContain('security-sensitive');
    expect(classifyReviewFile({ path: 'pnpm-lock.yaml', status: 'modified', additions: 1, deletions: 0 })).toEqual(expect.arrayContaining(['dependency', 'config']));
  });

  it('builds stable review action feedback keys', () => {
    expect(reviewFileActionKey('src/a.ts')).toBe('file:src/a.ts');
    expect(reviewHunkActionKey('src/a.ts', 'h1', 'revert_hunk')).toBe('hunk:src/a.ts:h1:revert_hunk');
  });

  it('sends file revert request and writes sending → requested into the store', async () => {
    const t = fakeTransport();
    await requestReviewFileRevert(t, 's1', 'src/a.ts');
    expect(t.send).toHaveBeenCalledWith('s1', 'review.revert_file', { session_id: 's1', path: 'src/a.ts' });
    expect(useReview.getState().actionStatus['file:src/a.ts']?.status).toBe('requested');
  });

  it('writes failed status when transport.send rejects', async () => {
    const t = fakeTransport(vi.fn().mockRejectedValue(new Error('disconnected')));
    await expect(requestReviewFileRevert(t, 's1', 'src/a.ts')).rejects.toThrow('disconnected');
    const status = useReview.getState().actionStatus['file:src/a.ts'];
    expect(status?.status).toBe('failed');
    expect(status?.message).toBe('disconnected');
  });

  it('sends hunk rework request and writes status into the store', async () => {
    const t = fakeTransport();
    await requestReviewHunkRevision(t, 's1', 'src/a.ts', { id: 'h1', header: '@@ -1 +1 @@', startLine: 1, additions: 1, deletions: 1 });
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', {
      session_id: 's1',
      path: 'src/a.ts',
      hunk_id: 'h1',
      hunk_header: '@@ -1 +1 @@',
      action: 'request_rework',
    });
    expect(useReview.getState().actionStatus['hunk:src/a.ts:h1:request_rework']?.status).toBe('requested');
  });

  it('sends hunk revert request and writes status into the store', async () => {
    const t = fakeTransport();
    await requestReviewHunkRevert(t, 's1', 'src/a.ts', { id: 'h1', header: '@@ -1 +1 @@', startLine: 1, additions: 1, deletions: 1 });
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', {
      session_id: 's1',
      path: 'src/a.ts',
      hunk_id: 'h1',
      hunk_header: '@@ -1 +1 @@',
      action: 'revert_hunk',
    });
    expect(useReview.getState().actionStatus['hunk:src/a.ts:h1:revert_hunk']?.status).toBe('requested');
  });
});
