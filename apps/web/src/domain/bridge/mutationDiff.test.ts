import { describe, expect, it } from 'vitest';
import {
  buildHunkRevertNote,
  parseMutationDiffHunks,
} from './mutationDiff';

describe('parseMutationDiffHunks', () => {
  it('returns empty list for null/empty input', () => {
    expect(parseMutationDiffHunks(null)).toEqual([]);
    expect(parseMutationDiffHunks(undefined)).toEqual([]);
    expect(parseMutationDiffHunks('')).toEqual([]);
  });

  it('parses two hunks with line classification and counts', () => {
    const preview =
      '--- a/src/foo.ts\n' +
      '+++ b/src/foo.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      '-old line\n' +
      '+new line\n' +
      ' context line\n' +
      '@@ -10 +10 @@\n' +
      '-a\n' +
      '+b';
    const hunks = parseMutationDiffHunks(preview);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      id: 'hunk-1',
      header: '@@ -1,3 +1,3 @@',
      additions: 1,
      deletions: 1,
    });
    expect(hunks[0]?.lines).toEqual([
      { kind: 'del', text: 'old line' },
      { kind: 'add', text: 'new line' },
      { kind: 'ctx', text: 'context line' },
    ]);
    expect(hunks[1]).toMatchObject({
      id: 'hunk-2',
      header: '@@ -10 +10 @@',
      additions: 1,
      deletions: 1,
    });
  });

  it('classifies +++/--- header lines as meta and does not count them', () => {
    const preview =
      '@@ -1 +1 @@\n' +
      '--- a/x\n' +
      '+++ b/x\n' +
      '+real add';
    const [h] = parseMutationDiffHunks(preview);
    expect(h?.additions).toBe(1);
    expect(h?.deletions).toBe(0);
    expect(h?.lines.filter((l) => l.kind === 'meta')).toHaveLength(2);
  });

  it('ignores lines before the first @@ marker', () => {
    const preview = 'preamble\n@@ -1 +1 @@\n+only';
    const hunks = parseMutationDiffHunks(preview);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines).toEqual([{ kind: 'add', text: 'only' }]);
  });

  it('keeps a "new file" preview line as meta inside the hunk', () => {
    const preview = '@@ new file @@\nnew file (no prior content)\n+hello';
    const [h] = parseMutationDiffHunks(preview);
    expect(h?.lines[0]).toEqual({ kind: 'meta', text: 'new file (no prior content)' });
    expect(h?.additions).toBe(1);
  });
});

describe('buildHunkRevertNote', () => {
  it('mentions the hunk id, header, and parent summary', () => {
    const note = buildHunkRevertNote(
      { summary: 'Refactor token store' },
      { id: 'hunk-2', header: '@@ -10 +10 @@' },
    );
    expect(note).toContain('hunk-2');
    expect(note).toContain('@@ -10 +10 @@');
    expect(note).toContain('Refactor token store');
  });
});
