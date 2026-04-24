# Plan 21 — Review tab + diff worker

**Phase**: 3 · **Depends on**: Plan 16 (Shiki worker), 19 · **Blocks**: Phase 3 exit · **Est**: 2 days

## Goal

Show the pending changeset: list of modified files, lazy-loaded unified diff per file, virtualized hunks, revert actions, syntax-highlighted diff bodies. Compute diffs in a Web Worker for large files.

## Why this is hard

Diffs blow up in size quickly. A naive implementation renders everything upfront and stutters. The combination lazy load + virtualize + worker-compute + highlight-in-worker must interleave without race conditions.

## Scope

### In
- Review tab with file list.
- Per-file lazy diff body.
- Virtualized hunks for large diffs.
- Word-level diff on demand.
- Revert file + revert all.
- Diff worker for files > 50KB.
- Syntax highlight via Shiki worker.

### Out
- Interactive per-hunk staging (post-v1).
- 3-way merge UI (N/A).

## Deliverables

```
apps/web/src/
├── stores/review.ts
├── domain/review/
│   ├── hooks.ts
│   └── handlers.ts
├── components/
│   └── Workbench/Review/
│       ├── ReviewTab.tsx
│       ├── FileList.tsx
│       ├── FileItem.tsx
│       ├── DiffView.tsx
│       ├── Hunk.tsx
│       └── RevertControls.tsx
├── workers/
│   └── diff.worker.ts
```

## Stages

### S1 — Store (0.2 day)

```ts
interface ReviewSlice {
  changeset: Map<Path, FileEntry>;
  files: Path[];
  activePath: Path | null;
  diffCache: Map<Path, DiffResult>;   // parsed hunks
  highlightedCache: Map<Path, HighlightedDiff>;
  onChangesetUpdated(files: FileSummary[]): void;
  openFile(path: Path): void;
  requestDiff(path: Path): Promise<DiffResult>;
  revertFile(path: Path): Promise<void>;
  revertAll(): Promise<void>;
}
```

FileEntry: `{ path, changeKind: 'added'|'modified'|'deleted'|'renamed', sizeOld, sizeNew, sha }`.

**Exit**: store tested; open + close files doesn't trigger duplicate fetches.

### S2 — `<ReviewTab/>` skeleton (0.2 day)

Split layout:
- Wide viewport: `<FileList>` left (30%) + `<DiffView>` right (70%).
- Narrow: `<FileList>` only; opening file launches `diff_viewer` overlay.

Layout is auto from CSS; content logic is the same.

**Exit**: tab renders; selecting file shows empty DiffView placeholder.

### S3 — `<FileList/>` (0.2 day)

```tsx
function FileList() {
  const files = useReview(s => s.files);
  const active = useReview(s => s.activePath);
  return (
    <nav className="file-list">
      {files.map(p => <FileItem key={p} path={p} active={p === active} />)}
    </nav>
  );
}
```

FileItem: path (with truncation), change-kind badge (+added, ~modified, -deleted), hunk count, click → openFile.

Sort + filter controls (by folder, by change kind).

**Exit**: file list rendered; selection highlight works.

### S4 — Diff fetch + parse (0.3 day)

On openFile:
1. Check cache; return if present.
2. Send `review.open_file { path }`.
3. Bridge returns `review.diff_ready` event with diff body (unified format).
4. Parse unified diff into structured hunks.

Parsing in worker for large payloads (> 50KB):
```ts
// workers/diff.worker.ts
import { parsePatch } from 'diff';
self.onmessage = (e) => {
  const { id, unified } = e.data;
  const parsed = parsePatch(unified);
  self.postMessage({ id, parsed });
};
```

Main-thread wrapper: if small → parse sync; else → post to worker.

**Exit**: small file parses in < 5ms; large file (500KB) in worker < 300ms.

### S5 — `<Hunk/>` component (0.2 day)

```tsx
function Hunk({ hunk, lang }) {
  const [expanded, setExpanded] = useState(!hunk.large);
  if (!expanded) return <button onClick={() => setExpanded(true)}>Show hunk ({hunk.linesChanged} lines)</button>;
  return (
    <div className="hunk">
      <header className="hunk-header">
        @@ {hunk.oldStart},{hunk.oldLines} → {hunk.newStart},{hunk.newLines} @@
      </header>
      <table>
        {hunk.lines.map((l, i) => <Line key={i} line={l} lang={lang} />)}
      </table>
    </div>
  );
}
```

Each line: `+`, `-`, context.
Syntax highlight per line via Shiki worker (Plan 16).
Large hunks (> 200 lines): default collapsed.

**Exit**: hunks display; expand/collapse works.

### S6 — Virtualization for many hunks (0.2 day)

If file has > 20 hunks: virtualize the hunk list (TanStack Virtual).

Measure each hunk height on expand → use for virtual positioning.

**Exit**: 500-hunk file renders first paint < 200ms.

### S7 — Word-level diff (0.2 day)

Optional enhancement: within an `-` / `+` line pair, run word-level diff to highlight intra-line changes.

```ts
// in worker, or main-thread for small lines
import { diffWords } from 'diff';
function wordDiff(oldLine, newLine) {
  return diffWords(oldLine, newLine);
}
```

Only for modified lines, only if line length < 500 chars. Renders as inline colored spans.

Toggle in diff header: "Show word diff".

**Exit**: word diff visible when enabled.

### S8 — Revert actions (0.2 day)

Revert file: `review.revert_file { path }` → bridge applies undo → emits `review.changeset_updated` → file removed from list.

Revert all: confirmation dialog (`confirm` overlay) → `review.revert_all` → full changeset cleared.

Disabled when `activePath === null` (revert file) or changeset empty.

Keyboard: `Ctrl+X` revert file, `Ctrl+Z` revert all (matches TUI).

**Exit**: revert works end-to-end; changeset updates live.

### S9 — Perf bench (0.1 day)

`bench:diff` per `perf-test-plan.md §3.2`:
- 100-file changeset, 20KB avg.
- First paint ≤ 200ms, full mount ≤ 1s.
- Expand file ≤ 300ms.

**Exit**: bench green.

## Testing

- Unit: diff parse fidelity.
- Integration: real git diff fixtures.
- Perf: large-diff fixture runs within budget.

## Exit criteria

- [ ] E2E: agent edits files → Review shows them → user opens → sees diff → reverts.
- [ ] Large changeset responsive.
- [ ] Word diff toggle works.
- [ ] Revert per-file + revert all work.
- [ ] `bench:diff` passes.

## Risks

| Risk | Mitigation |
|---|---|
| Worker serialization cost for medium files | Threshold 50KB tuned; below = sync |
| Syntax highlight of diff lines confuses colors | Line-kind class wraps highlighted spans; CSS precedence explicit |
| Very long lines break layout | CSS `white-space: pre; overflow-x: auto` per line |
| Revert race (agent re-edits during UI wait) | Optimistic UI + rollback on conflict |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §7
- [`perf-test-plan.md`](../../perf-test-plan.md) §3.2
- Plan 16 — Shiki worker (reused)
- Plan 19 — overlays (narrow viewport modal)
