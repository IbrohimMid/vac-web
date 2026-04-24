# Plan 16 — Shiki worker + lazy syntax highlight

**Phase**: 2 · **Depends on**: Plan 15 · **Blocks**: Phase 2 exit · **Est**: 1 day

## Goal

Syntax-highlight code blocks off-thread, lazily (only when visible), cached by content hash. This is the feature that makes transcripts actually readable without trashing frame rate.

## Why this is hard

Shiki is accurate (uses TextMate grammars) but heavy: grammars + theme WASM. Naive usage blocks main thread on large code blocks. Visibility gating + worker-side LRU cache + graceful first-paint (plain `<pre>` before highlight) is what makes it feel instant.

## Scope

### In
- Shiki loaded in Web Worker.
- Visibility-gated highlight via `IntersectionObserver`.
- Pre-highlight fallback: plain monospaced `<pre>`.
- Worker-side LRU cache (500 entries).
- Language autodetect fallback.
- Code block collapse for > 10,000 chars.

### Out
- Line annotations (post-v1).
- Diff syntax (Plan 21 uses this worker for diff highlighting).

## Deliverables

```
apps/web/src/
├── workers/
│   └── shiki.worker.ts
├── highlight/
│   ├── client.ts          # main-thread API
│   ├── visibility.ts      # IntersectionObserver controller
│   ├── autodetect.ts      # fallback language guess
│   └── collapse.tsx       # large block UI
```

## Stages

### S1 — Worker setup (0.2 day)

```ts
// workers/shiki.worker.ts
import { getHighlighter } from 'shiki';

let highlighter: Highlighter | null = null;
const cache = new LRU<string, string>({ max: 500 });

async function init() {
  highlighter = await getHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: ['typescript','javascript','rust','python','bash','json','yaml','go','sql','html','css','markdown'],
  });
}

self.onmessage = async (e) => {
  const { id, code, lang, theme } = e.data;
  if (!highlighter) await init();
  const key = `${lang}|${theme}|${hash(code)}`;
  let html = cache.get(key);
  if (!html) {
    html = highlighter!.codeToHtml(code, { lang, theme });
    cache.set(key, html);
  }
  self.postMessage({ id, html });
};
```

Language list additive via lazy load: if requested lang not loaded, call `highlighter.loadLanguage(lang)` first.

Bundle size: base grammars ~300KB; extras fetched on demand.

**Exit**: worker initializes; first call to known lang returns highlighted HTML.

### S2 — Client wrapper (0.2 day)

```ts
const worker = new Worker(new URL('../workers/shiki.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<string, (h: string) => void>();
worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data.html); pending.delete(e.data.id); };

export function highlight(code: string, lang: string, theme: string): Promise<string> {
  const id = ulid();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, code, lang, theme });
  });
}
```

Timeout: 5s; fallback to plain escape-pre.

**Exit**: `await highlight('const x=1','typescript','github-dark')` returns HTML string.

### S3 — Visibility gating (0.2 day)

In `MessageRow` (or rendered HTML post-processor):
- After message HTML mounts, scan for `<pre data-lang="...">` blocks.
- Attach IntersectionObserver; when block enters viewport:
  - Mark as "queued".
  - Call `highlight(code, lang, theme)`.
  - On response: replace innerHTML; mark "highlighted".
- Blocks that never scroll into view stay plain (saves work).

Theme: read from CSS var / `data-theme`; re-highlight on theme change (invalidate via new key).

**Exit**: transcript with 100 code blocks only highlights the ~5 visible on first render.

### S4 — Collapse for large blocks (0.2 day)

During markdown render (Plan 15): any code block > 10,000 chars wrapped with:
```html
<details class="code-collapse" data-lang="...">
  <summary>{{line_count}} lines of {{lang}} · click to expand</summary>
  <pre>…full code…</pre>
</details>
```

Only highlighted when opened. User preference (expand-all, collapse-all) via UI setting.

**Exit**: 20k-line fixture doesn't trigger highlight unless user opens.

### S5 — Autodetect fallback (0.1 day)

If code block has no explicit lang: use a tiny heuristic (first 500 chars):
- JSON-like: `{` and `}` + `"..."` patterns.
- Shell: `$`, `#!/bin/`, `export VAR=`.
- Python: `def `, `import `, indent-based.
- Fall back to `plaintext`.

Library `highlight.js/auto` is too heavy; hand-roll small heuristic or use `lang-detector` (~5KB).

**Exit**: unlabeled code blocks get reasonable highlight; plaintext fallback when uncertain.

### S6 — Theme switching (0.1 day)

On theme change (`data-theme="dark"` ↔ light):
- Invalidate cached keys (worker-side cache key includes theme).
- Walk visible `<pre>` with `data-highlighted="true"`, re-invoke highlight.
- Plain blocks unaffected.

**Exit**: theme toggle re-highlights visible blocks within 200ms.

### S7 — Perf budget & metrics (0.2 day)

Track in dev:
- Highlight call count per second.
- Average highlight latency.
- Cache hit rate.
- Worker queue depth.

Expose via `perf/trace.ts`; dev overlay.

CI bench: 100 code blocks each 2KB, all visible; p95 highlight latency ≤ 150ms, cache second run ≤ 10ms.

**Exit**: meets budget.

## Testing

- Fixture: transcripts with code blocks in 12 languages.
- Perf bench (Plan 33 consumes).
- Edge: malformed code, grammar crashes → fallback plain.

## Exit criteria

- [ ] Visible blocks highlighted < 150ms after scroll-into-view p95.
- [ ] 500-entry LRU cache hit rate > 90% after warmup.
- [ ] Collapse for > 10k chars works.
- [ ] Theme switch re-highlights.
- [ ] Main thread never blocked > 16ms by highlight.

## Risks

| Risk | Mitigation |
|---|---|
| Shiki WASM load slow on first visible block | Pre-init worker at app start (warm); fallback to plain if > 500ms elapsed |
| Grammar missing for user's language | Lazy-load + timeout + fallback plaintext |
| Re-highlight thrash on fast theme toggle | Debounce 300ms |
| Worker bundle bloat | Initial langs minimal (12); lazy rest |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §5.5
- [`perf-test-plan.md`](../../perf-test-plan.md)
- Plan 15 — markdown (upstream; emits `<pre data-lang>`)
- Plan 21 — diff viewer (reuses worker)
