import { beforeEach, describe, expect, it } from 'vitest';
import { useReview } from './review';

function reset() {
  useReview.setState({ files: [], diffs: new Map(), pendingFetch: new Set() });
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
});
