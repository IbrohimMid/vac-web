import { describe, expect, it, vi } from 'vitest';
import { classifyReviewFile, parseUnifiedHunks, requestReviewFileRevert, requestReviewHunkRevert, requestReviewHunkRevision, reviewFileActionKey, reviewHunkActionKey } from './actions';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return { send: vi.fn().mockResolvedValue({} as never), on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

describe('review actions helpers', () => {
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

  it('sends file revert request', async () => {
    const t = fakeTransport();
    await requestReviewFileRevert(t, 's1', 'src/a.ts');
    expect(t.send).toHaveBeenCalledWith('s1', 'review.revert_file', { session_id: 's1', path: 'src/a.ts' });
  });

  it('builds stable review action feedback keys', () => {
    expect(reviewFileActionKey('src/a.ts')).toBe('file:src/a.ts');
    expect(reviewHunkActionKey('src/a.ts', 'h1', 'revert_hunk')).toBe('hunk:src/a.ts:h1:revert_hunk');
  });

  it('sends hunk rework request', async () => {
    const t = fakeTransport();
    await requestReviewHunkRevision(t, 's1', 'src/a.ts', { id: 'h1', header: '@@ -1 +1 @@', startLine: 1, additions: 1, deletions: 1 });
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', {
      session_id: 's1',
      path: 'src/a.ts',
      hunk_id: 'h1',
      hunk_header: '@@ -1 +1 @@',
      action: 'request_rework',
    });
  });
});


  it('sends hunk revert request', async () => {
    const t = fakeTransport();
    await requestReviewHunkRevert(t, 's1', 'src/a.ts', { id: 'h1', header: '@@ -1 +1 @@', startLine: 1, additions: 1, deletions: 1 });
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', {
      session_id: 's1',
      path: 'src/a.ts',
      hunk_id: 'h1',
      hunk_header: '@@ -1 +1 @@',
      action: 'revert_hunk',
    });
  });
