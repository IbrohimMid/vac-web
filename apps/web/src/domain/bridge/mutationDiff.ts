// Phase B7 (Sprint B): Hunk-level rendering for MutationInbox `diff_preview`.
// Parses the bridge-supplied unified diff preview into structured hunks with
// per-line classification (add / del / ctx / meta) so the inbox can render
// colored hunks instead of a flat <pre> block. Also exposes a deterministic
// note generator for the per-hunk "Request hunk revert" action — the inbox
// surfaces revert as a refine_request scoped to a single hunk, which keeps
// the bridge command surface minimal (no new mutation command needed).

export type MutationDiffLineKind = 'add' | 'del' | 'ctx' | 'meta';

export interface MutationDiffLine {
  kind: MutationDiffLineKind;
  text: string;
}

export interface MutationDiffHunk {
  id: string;
  header: string;
  startLine: number;
  additions: number;
  deletions: number;
  lines: MutationDiffLine[];
}

export function parseMutationDiffHunks(
  preview: string | null | undefined,
): MutationDiffHunk[] {
  if (!preview) return [];
  const rawLines = preview.split('\n');
  const hunks: MutationDiffHunk[] = [];
  let current: MutationDiffHunk | null = null;
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] ?? '';
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = {
        id: `hunk-${hunks.length + 1}`,
        header: line,
        startLine: i + 1,
        additions: 0,
        deletions: 0,
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---')) {
      current.lines.push({ kind: 'meta', text: line });
      continue;
    }
    if (line.startsWith('+')) {
      current.additions += 1;
      current.lines.push({ kind: 'add', text: line.slice(1) });
      continue;
    }
    if (line.startsWith('-')) {
      current.deletions += 1;
      current.lines.push({ kind: 'del', text: line.slice(1) });
      continue;
    }
    if (line.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: line.slice(1) });
      continue;
    }
    // Fallback for non-prefixed lines (e.g. "new file" preview text from the
    // bridge): keep them as meta so they render in muted color and never count
    // toward +/-.
    current.lines.push({ kind: 'meta', text: line });
  }
  if (current) hunks.push(current);
  return hunks;
}

/** Deterministic refine note for the per-hunk revert button. */
export function buildHunkRevertNote(
  intent: { summary: string },
  hunk: Pick<MutationDiffHunk, 'id' | 'header'>,
): string {
  return (
    `Please revert ${hunk.id} (${hunk.header}) from "${intent.summary}". ` +
    `Keep the other hunks in this mutation unchanged.`
  );
}
