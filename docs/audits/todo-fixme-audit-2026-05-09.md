# TODO/FIXME Backlog Audit - 2026-05-09

Status: complete. Raw inventory captured with `grep -rn 'TODO|FIXME|XXX|HACK' apps/ tools/ crates/ packages/ scripts/ 2>/dev/null > /tmp/todos.txt`.

## Total Count

- Raw grep hits: 34 lines across 18 files
- Generated noise: 26 hits from `apps/web/node_modules` and `apps/web/dist`
- Actionable source/script hits: 8

## Breakdown By Directory

| Directory | Hits | Notes |
| --- | ---: | --- |
| `apps/web/node_modules` | 23 | Generated Vite dependency / sourcemap output. |
| `scripts` | 4 | Real source files. |
| `apps/web/dist` | 3 | Generated build output. |
| `apps/local-bridge/src` | 2 | Real source files. |
| `apps/web/src` | 1 | Real source file. |
| `apps/local-bridge/tests` | 1 | Real test source. |

## Breakdown By Tag

Raw occurrence counts are inflated by generated sourcemap content under `apps/web/node_modules/.vite`.

| Tag | Raw occurrence count | Actionable source count |
| --- | ---: | ---: |
| `TODO` | 263 | 8 |
| `FIXME` | 19 | 0 |
| `XXX` | 3 | 0 |
| `HACK` | 5 | 0 |

## Categorized Table

| File:line | Tag | Comment | Suggested category |
| --- | --- | --- | --- |
| `apps/web/src/components/Migration/MigrationTab.tsx:37` | `TODO` | `phase-8.5 integration`: wire dry-run / verify / dispatch buttons | Future feature |
| `apps/local-bridge/tests/event_catalog_parity.rs:31` | `TODO` | every entry here is a TODO to either promote into the catalog or... | Tech debt |
| `apps/local-bridge/src/tunnel.rs:118` | `TODO` | `phase-7.3 integration`: route tunnel frames through the session | Future feature |
| `apps/local-bridge/src/observability.rs:116` | `TODO` | `Pass #22; full ADR follow-up tracked as a deferred TODO.` | Stale |
| `scripts/vac-command-new.mjs:95` | `TODO` | move under the correct section heading and add fields | Tech debt |
| `scripts/vac-pr-checklist.mjs:2` | `TODO` | generate a markdown TODO checklist for a PR body | Tech debt |
| `scripts/vac-pr-checklist.mjs:4` | `TODO` | `Slice 39 step_03 (PR-body TODO checklist generator).` | Stale |
| `scripts/vac-pr-checklist.mjs:32` | `TODO` | emit a PR-body TODO checklist | Tech debt |

## Stale Candidates

These markers reference slices or passes that are already closed in `docs/plans/wiring/`.

- `apps/local-bridge/src/observability.rs:116` references Pass #22 / Slice 41, which is closed.
- `scripts/vac-pr-checklist.mjs:4` references Slice 39, which is closed.

## Sample Fixes

### `apps/local-bridge/src/observability.rs:116`

Before:

```rs
/// Pass #22; full ADR follow-up tracked as a deferred TODO.
```

After:

```rs
/// Namespace-prefix follow-up is documented in the ADR set.
```

### `scripts/vac-pr-checklist.mjs:4`

Before:

```js
// Slice 39 step_03 (PR-body TODO checklist generator).
```

After:

```js
// PR-body checklist generator.
```

### `scripts/vac-command-new.mjs:95`

Before:

```js
`  # TODO(${id}): move under the correct section heading and add fields`,
```

After:

```js
`  # Helper: move under the correct section heading and add fields`,
```

This one is still a valid implementation reminder; if it remains open, replace the generic comment with a tracked issue or remove it once the helper knows the correct sectioning.

### `apps/web/src/components/Migration/MigrationTab.tsx:37`

Before:

```tsx
// TODO(phase-8.5 integration): wire dry-run / verify / dispatch buttons
```

After:

```tsx
// TODO(tracked): wire dry-run / verify / dispatch buttons
```

### `apps/local-bridge/src/tunnel.rs:118`

Before:

```rs
// TODO(phase-7.3 integration): route tunnel frames through the session
```

After:

```rs
// TODO(tracked): route tunnel frames through the session
```

## Recommended Next Actions

1. Remove generated artifacts from future backlog scans by excluding `apps/web/node_modules` and `apps/web/dist`.
2. Rewrite or delete the stale Pass #22 and Slice 39 comments.
3. Decide whether the phase-8.5 and phase-7.3 TODOs need explicit tickets or should be closed out.
4. Keep helper-script TODO comments short and actionable so future audits do not need to infer intent.

## UX Impact

None. This is repository hygiene only; no end-user behavior changed.
