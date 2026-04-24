# Phase 2.1 — Transcript Architecture (Hot/Cold + Markdown)

**Duration**: 3 days
**Position**: first sub-phase of Phase 2 (cockpit polish); after Phase 1.7 exit
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Turn the Phase 1.6 plain-text transcript into a performant, markdown-rendered surface. Two things combined because they share the same store + render path:

1. **Hot window / cold freeze** — only last 50 messages live React; older messages serialize to sanitized HTML + `React.memo` with always-true comparator + never re-render.
2. **Markdown streaming strategy** — during stream: plain text + fenced code detection; on `transcript.completed`: full markdown-it parse via worker for large payloads, sync for small.

Combining because freezing needs the renderer; splitting creates two incomplete halves.

## Entry criteria

- Phase 1.7 exit: 94+ workspace tests green, TS typecheck clean, vite build passing.
- Web scaffold functional: pair → session → streaming works (ugly).
- `pnpm install` fresh; markdown-it + DOMPurify installable.

## Scope

### In
- `transcript` store upgraded with `hotWindowIds: Set<MessageId>`, `isCold: boolean`, `renderedHTML?: string` per message.
- `FreezeController` runs after `transcript.completed`: if hotWindow > 50 + message completed → `freeze(id)` serializes markdown to HTML.
- `<ColdMessage/>` component using sanitized `dangerouslySetInnerHTML`; `React.memo(_, () => true)` never re-renders.
- TanStack Virtual over the full order array; dynamic row measurement.
- `renderStreaming(text)` — lightweight React tree for streaming state: plain text + fence-detected `<pre>` blocks.
- `renderMarkdown(src)` — markdown-it + DOMPurify; called on completion; cached per message.
- `markdown.worker.ts` — off-main-thread parse for `src.length > 20_000`.
- Per-message `RenderCache` with quick hash invalidation.
- DOMPurify config extracted; shared between streaming fallback + completed path + ColdMessage.

### Out
- Syntax highlighting of code blocks (Phase 2.2).
- Command palette / slash commands (Phase 2.3).
- Overlay manager for diff/shell (Phase 2.5).

## Granular plans

- [`docs/plans/phase-2/14-transcript-hot-cold.md`](../phase-2/14-transcript-hot-cold.md)
- [`docs/plans/phase-2/15-markdown-streaming.md`](../phase-2/15-markdown-streaming.md)

## Day-by-day

### Day 1 — Store upgrade + freeze controller
- Extend `stores/transcript.ts` with `isCold`, `renderedHTML`, `hotWindowIds`.
- `FreezeController` module: ticks on `transcript.completed` event + idle-callback throttle (500ms).
- Unit tests (Vitest) for freeze state machine.
- No UI changes yet.

### Day 2 — Markdown pipeline (sync path)
- Install `markdown-it`, `isomorphic-dompurify`.
- `markdown/sanitize.ts` — single DOMPurify config (allowed tags from `frontend-rules.md §5.3`).
- `markdown/full.ts` — `renderMarkdown(src): string` via markdown-it.
- `markdown/streaming.ts` — `renderStreaming(text): ReactNode` with fence detection.
- `markdown/cache.ts` — `RenderCache` keyed by `msgId + quickHash(content)`.
- `<MessageRow/>` uses streaming during state=streaming, cached full render on completion.
- DOMPurify injection harness (5 common XSS vectors → all neutralized).

### Day 3 — Worker + virtualization + ColdMessage
- `workers/markdown.worker.ts` — same renderer off-thread for `src.length > 20_000`.
- `renderMarkdownAsync(id, src)` dispatches to worker if threshold exceeded.
- TanStack Virtual integrated in `<Transcript/>`; `estimateSize: 200`, overscan 5, dynamic measure.
- `<ColdMessage/>` with `dangerouslySetInnerHTML` + sticky `React.memo`.
- Event delegation for copy-code buttons in cold HTML (Plan 14 S6 scope-reduced).
- `bench:transcript` smoke test: 10k messages simulated, scroll + stream → no crash, FPS log.

## Deliverables

```
apps/web/src/
├── stores/transcript.ts          (upgraded)
├── markdown/
│   ├── sanitize.ts
│   ├── streaming.tsx
│   ├── full.ts
│   └── cache.ts
├── workers/markdown.worker.ts
├── transcript/
│   ├── FreezeController.ts
│   └── renderToHTML.ts
└── components/Transcript/
    ├── Transcript.tsx           (virtualized)
    ├── MessageRow.tsx           (streaming + completed)
    └── ColdMessage.tsx          (frozen)
```

## Exit criteria (gate to Phase 2.2)

- [ ] Markdown rendering works for completed messages (tables, lists, code fences, links).
- [ ] Stream-in-progress uses lightweight renderer (no markdown-it call per delta).
- [ ] 10k-message session: React DevTools shows ≤ 50 live MessageRow components.
- [ ] ColdMessage `React.memo` never re-renders (verified via profiler).
- [ ] DOMPurify neutralizes `<script>`, `onerror`, `javascript:` URI, inline `style`.
- [ ] Worker kicks in at > 20KB; main thread not blocked > 16ms during flush.
- [ ] `pnpm -r typecheck` strict green.
- [ ] `pnpm -r build` green; bundle increase ≤ 80KB gzipped.

## Perf budgets (hard gate)

| Metric | Budget |
|---|---|
| FPS during streaming (500 tokens/s) | ≥ 50 p95 |
| TTF-token paint after event arrival | ≤ 50ms |
| Active DOM nodes at 10k messages | ≤ 8,000 |
| Markdown parse (10KB message) | ≤ 30ms main-thread |
| Markdown parse (100KB message) | ≤ 400ms worker |

Baselines captured → `perf/baselines/transcript-phase-2.1.json`.

## Risks

| Risk | Mitigation |
|---|---|
| Premature freeze on streaming message | Assert `state === 'completed'` at entry; test edge |
| DOMPurify blocks legitimate markdown output | Allowlist tuned from markdown-it's actual output; fixture corpus |
| Worker boundary serialization cost | Threshold 20KB tuned empirically; below = sync |
| Virtual list "jumpy" on dynamic heights | Debounce measure 50ms; cap frequency |
| React.memo(_, () => true) prevents updates | Documented: cold messages never update until unfreeze |

## Related

- [`docs/frontend-rules.md §5`](../../frontend-rules.md) — authoritative transcript spec
- [`docs/perf-test-plan.md §3.1`](../../perf-test-plan.md) — bench:transcript
- Plan 14 — hot/cold granular
- Plan 15 — markdown granular

## Handoff to Phase 2.2

Phase 2.2 (Shiki worker) hooks `<pre data-lang>` blocks emitted by markdown-it here. The renderer must add `data-lang` attribute from fence info. Ensure that's in place before handoff.
