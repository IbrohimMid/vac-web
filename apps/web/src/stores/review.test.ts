import { beforeEach, describe, expect, it } from 'vitest';
import { useReview } from './review';

function reset() {
  useReview.setState({
    files: [],
    diffs: new Map(),
    pendingFetch: new Set(),
    actionStatus: {},
  });
}

describe('review store', () => {
  beforeEach(reset);

  it('setFiles replaces list', () => {
    useReview.getState().setFiles([
      { path: 'a', status: 'modified', additions: 1, deletions: 0 },
    ]);
    expect(useReview.getState().files).toHaveLength(1);
  });

  it('setDiff clears pendingFetch for that path', () => {
    useReview.getState().markFetching('a');
    expect(useReview.getState().isFetching('a')).toBe(true);
    useReview.getState().setDiff({ path: 'a', unified: 'x', truncated: false });
    expect(useReview.getState().isFetching('a')).toBe(false);
  });

  it('removeFile drops diff + file', () => {
    useReview.getState().setFiles([{ path: 'a', status: 'modified', additions: 0, deletions: 0 }]);
    useReview.getState().setDiff({ path: 'a', unified: 'x', truncated: false });
    useReview.getState().removeFile('a');
    expect(useReview.getState().files).toHaveLength(0);
    expect(useReview.getState().diffs.has('a')).toBe(false);
  });

  it('setActionStatus upserts feedback by key and stamps updatedAt', () => {
    useReview.getState().setActionStatus({
      key: 'file:src/a.ts',
      status: 'sending',
      message: 'Sending...',
    });
    const first = useReview.getState().actionStatus['file:src/a.ts'];
    expect(first?.status).toBe('sending');
    expect(typeof first?.updatedAt).toBe('number');

    useReview.getState().setActionStatus({
      key: 'file:src/a.ts',
      status: 'requested',
      message: 'Sent.',
    });
    expect(useReview.getState().actionStatus['file:src/a.ts']?.status).toBe('requested');
    expect(useReview.getState().actionStatus['file:src/a.ts']?.message).toBe('Sent.');
  });

  it('clearActionStatus removes a single key', () => {
    useReview.getState().setActionStatus({ key: 'file:a', status: 'requested', message: 'x' });
    useReview.getState().setActionStatus({ key: 'file:b', status: 'requested', message: 'y' });
    useReview.getState().clearActionStatus('file:a');
    expect(useReview.getState().actionStatus['file:a']).toBeUndefined();
    expect(useReview.getState().actionStatus['file:b']?.status).toBe('requested');
  });

  it('clearAllActionStatus wipes every feedback entry', () => {
    useReview.getState().setActionStatus({ key: 'file:a', status: 'requested', message: 'x' });
    useReview.getState().setActionStatus({ key: 'hunk:a:h1:revert_hunk', status: 'sending', message: 'y' });
    useReview.getState().clearAllActionStatus();
    expect(Object.keys(useReview.getState().actionStatus)).toHaveLength(0);
  });

  it('removeFile prunes action feedback keyed to that path', () => {
    useReview.getState().setFiles([{ path: 'src/a.ts', status: 'modified', additions: 0, deletions: 0 }]);
    useReview.getState().setActionStatus({ key: 'file:src/a.ts', status: 'requested', message: 'x' });
    useReview.getState().setActionStatus({ key: 'hunk:src/a.ts:h1:revert_hunk', status: 'requested', message: 'y' });
    useReview.getState().setActionStatus({ key: 'file:src/b.ts', status: 'requested', message: 'z' });
    useReview.getState().removeFile('src/a.ts');
    const status = useReview.getState().actionStatus;
    expect(status['file:src/a.ts']).toBeUndefined();
    expect(status['hunk:src/a.ts:h1:revert_hunk']).toBeUndefined();
    expect(status['file:src/b.ts']?.status).toBe('requested');
  });

  it('clear() resets actionStatus along with files and diffs', () => {
    useReview.getState().setFiles([{ path: 'a', status: 'modified', additions: 0, deletions: 0 }]);
    useReview.getState().setActionStatus({ key: 'file:a', status: 'requested', message: 'x' });
    useReview.getState().clear();
    expect(useReview.getState().files).toHaveLength(0);
    expect(Object.keys(useReview.getState().actionStatus)).toHaveLength(0);
  });
});
