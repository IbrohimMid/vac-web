# Phase 2.2 — Syntax Highlighting (Shiki Worker)

**Duration**: 1 day
**Position**: after Phase 2.1 (transcript architecture); before Phase 2.3 (command palette)
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Syntax-highlight code blocks off-main-thread, lazily (only when visible), cached by `(code, lang, theme)` hash. This is the feature that makes transcripts actually readable without trashing frame rate.

## Entry criteria

- Phase 2.1 exit: markdown emits `<pre data-lang="...">` for code blocks; cold message serialization preserves data attribute.
- ColdMessage event delegation established (Plan 14 S6) — we hook highlight via that channel.

## Scope

### In
- Shiki (WASM-based) loaded in a dedicated Web Worker.
- Visibility-gated highlight via `IntersectionObserver` on `<pre data-lang>` elements.
- Pre-highlight fallback: plain monospaced `<pre>` (instant; no layout flash).
- Worker-side LRU cache (500 entries) keyed by `(lang, theme, sha1(code))`.
- Language autodetect fallback (tiny heuristic, no heavy library).
- Code block collapse for > 10,000 chars (`<details>` wrapper).
- Theme switch re-highlights visible blocks.

### Out
- Line annotations (post-v1).
- Diff syntax highlight (Phase 3.2 review tab reuses worker).
- Monaco editor (lazy-loaded later only when plan editor needed).

## Granular plan

[`docs/plans/phase-2/16-shiki-worker.md`](../phase-2/16-shiki-worker.md)

## Day-by-day

### Day 1 — Full implementation

Morning:
- Install `shiki` in `apps/web/`.
- `workers/shiki.worker.ts` — bootstrap `getHighlighter({ themes, langs })` with core grammar set (12 langs) + LRU cache.
- Main-thread wrapper `highlight/client.ts` with pending map + timeout fallback.
- Lazy-load additional languages on demand.

Afternoon:
- `highlight/visibility.ts` — IntersectionObserver controller attached once on shell mount; walks rendered transcript for `pre[data-lang]:not([data-highlighted])`.
- Hook into post-render of MessageRow + ColdMessage (event bus or MutationObserver).
- `highlight/collapse.tsx` — `<CodeCollapseWrapper/>` hydrates `<details>` blocks with lazy expand.
- `highlight/autodetect.ts` — 50-line heuristic for unlabeled fences.
- Theme change listener: invalidate cache keys, re-highlight visible.

Perf check:
- 100-block transcript, scroll through → only visible blocks highlighted, p95 ≤ 150ms per block first-paint.

## Deliverables

```
apps/web/src/
├── workers/shiki.worker.ts
├── highlight/
│   ├── client.ts
│   ├── visibility.ts
│   ├── autodetect.ts
│   └── collapse.tsx
```

## Exit criteria (gate to Phase 2.3)

- [ ] Visible code blocks highlighted within 150ms p95 of entering viewport.
- [ ] LRU hit rate > 90% after warmup.
- [ ] Code block > 10k chars → collapsed by default; expand on click.
- [ ] Theme toggle re-highlights visible blocks.
- [ ] Main thread never blocked > 16ms by highlight.
- [ ] Bundle: Shiki chunk ≤ 300KB gzipped; lazy-imported so initial bundle unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Shiki WASM cold-start delay on first block | Pre-init worker at app mount (warm); fallback plain if > 500ms |
| Grammar missing for requested language | Lazy-load + 300ms timeout + fallback plaintext |
| Re-highlight thrash on fast theme toggle | Debounce 300ms |
| Cache key collision on different code, same hash | SHA1 of code is 160 bits; collision negligible at 500-entry scale |

## Related

- [`docs/frontend-rules.md §5.5`](../../frontend-rules.md) — syntax highlight spec
- Plan 16 — granular task breakdown

## Handoff to Phase 2.3

Phase 2.3 adds command palette. Unrelated to highlight path; both mount separately. Phase 2.2 makes transcript visually presentable before palette adds navigation.
