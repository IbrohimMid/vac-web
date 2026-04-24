# Plan 15 — Markdown streaming strategy + worker

**Phase**: 2 · **Depends on**: Plan 14 · **Blocks**: 16 · **Est**: 1.5 days

## Goal

Make completed messages render as polished markdown (with code blocks, lists, tables, links) while streaming messages remain instant/legible. Heavy messages parse in a Web Worker so the main thread stays responsive.

## Why this is hard

Two modes must coexist cleanly:
- **During stream**: fast, lossy, readable. No parse cost per token.
- **On completion**: full markdown, sanitized, cached.

Also: markdown-it is CPU-bound on long payloads; parsing in worker avoids main-thread stalls. But worker boundary introduces latency + serialization cost; must be judicious about when to use it.

## Scope

### In
- Lightweight streaming renderer (plain text + fence detection + line breaks).
- Full markdown renderer using markdown-it + plugins.
- DOMPurify sanitization in same pass.
- Web Worker for messages > 20KB.
- Per-message render cache.
- Integration into `<MessageRow/>` and `ColdMessage` HTML generator.

### Out
- Syntax highlight (Plan 16).
- Mermaid/math/etc. plugins (post-v1).

## Deliverables

```
apps/web/src/
├── markdown/
│   ├── index.ts
│   ├── streaming.ts           # lightweight renderer
│   ├── full.ts                # markdown-it pipeline
│   ├── sanitize.ts            # DOMPurify config (shared)
│   ├── cache.ts               # per-message cache
│   └── lint.ts                # unsafe pattern detection
├── workers/
│   └── markdown.worker.ts     # full.ts invoked off-thread
```

## Stages

### S1 — Streaming renderer (0.3 day)

Goals: zero parse, O(n) plain + light structure.

```ts
export function renderStreaming(text: string): ReactNode {
  // Detect fenced code blocks (``` ... ```).
  // Inside fence: render as <pre class="code-unfenced">{text}</pre>
  // Outside: escape + line-break.
  const segments = splitByFences(text);
  return segments.map((seg, i) =>
    seg.kind === 'code'
      ? <pre key={i} className="code-unfenced">{seg.text}</pre>
      : <React.Fragment key={i}>{lineBreaks(seg.text)}</React.Fragment>
  );
}
```

No React key instability: segment count only grows monotonically during stream.

Used in `<MessageRow/>` when `state === 'streaming'`.

**Exit**: streaming with code blocks visible; no parse allocation per delta.

### S2 — Full markdown pipeline (0.4 day)

```ts
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,              // never allow raw HTML
  linkify: true,
  breaks: true,
  typographer: false,
})
.use(tablePlugin)           // bundled
.use(taskListPlugin);

export function renderMarkdown(src: string): string {
  const raw = md.render(src);
  return sanitize(raw);
}
```

Sanitize: shared `sanitize.ts` from Plan 14.

Enhancements inline with renderer (no post-processing):
- Code blocks: wrap with `<pre data-lang="...">` for Plan 16 to hook.
- Links: `rel="noopener noreferrer"` + `target="_blank"` for external.
- Images: lazy-load `loading="lazy"`.

**Exit**: fixture corpus (common markdown: tables, nested lists, code, quotes) renders correctly.

### S3 — Lint (0.1 day)

`lint.ts` scans pre-sanitize for suspicious patterns:
- Raw HTML (already blocked, but flag as "sanitizer saved us").
- Excessive nesting (> 10 deep) → render fallback note.
- Malformed tables.

Logs to console in dev; telemetry in prod (opt-in).

**Exit**: lint catches known-bad fixture, passes known-good.

### S4 — Worker (0.3 day)

```ts
// workers/markdown.worker.ts
import MarkdownIt from 'markdown-it';
// same setup as full.ts
self.onmessage = (e) => {
  const { id, src } = e.data;
  const html = renderMarkdown(src);
  self.postMessage({ id, html });
};
```

Main-thread wrapper:
```ts
const worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<string, (h: string) => void>();
worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data.html); };

export function renderMarkdownAsync(id: string, src: string): Promise<string> {
  if (src.length < 20_000) return Promise.resolve(renderMarkdown(src));  // sync path
  return new Promise(res => { pending.set(id, res); worker.postMessage({ id, src }); });
}
```

Threshold 20KB based on measurement.

**Exit**: 100KB message renders in worker; main-thread not blocked.

### S5 — Cache (0.2 day)

```ts
class RenderCache {
  private cache = new Map<MessageId, { contentHash: string; html: string }>();
  get(id: MessageId, content: string): string | null {
    const entry = this.cache.get(id);
    const hash = quickHash(content);
    return entry?.contentHash === hash ? entry.html : null;
  }
  set(id: MessageId, content: string, html: string) {
    this.cache.set(id, { contentHash: quickHash(content), html });
  }
}
```

`quickHash`: 32-bit FNV-1a over string; collisions acceptable (cache miss worst case).

Invalidate on content change; drop entry when message frozen (HTML moves into store).

**Exit**: repeated render of same message served from cache in < 1ms.

### S6 — MessageRow integration (0.2 day)

```tsx
function MessageRow({ id }) {
  const msg = useMessage(id);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (msg.state !== 'completed') return;
    const cached = renderCache.get(id, msg.content);
    if (cached) { setHtml(cached); return; }
    renderMarkdownAsync(id, msg.content).then(h => {
      renderCache.set(id, msg.content, h);
      setHtml(h);
    });
  }, [msg.state, msg.content, id]);

  if (msg.state !== 'completed') return <StreamingBody text={msg.content} />;
  if (html === null) return <div className="rendering">rendering…</div>;
  return <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
```

StreamingBody uses `renderStreaming`.

**Exit**: completed messages show full markdown; streaming stays plain.

### S7 — Freeze integration (0.2 day)

`renderToHTML` (from Plan 14 S4) now delegates to `renderMarkdown` (sync path — large messages should already be cached from S6 before freeze). If cache miss: render sync (freeze already requires `completed`, so worker path is optional here).

**Exit**: cold messages retain full markdown formatting.

### S8 — Connector-fed content path (0.1 day)

When evidence preview includes Notion/GitHub fetched content:
- Always passed through sanitize with **extra-strict** config (images optional, tables allowed, no raw URLs executed).
- Rendered into small inline container, not full message area.

**Exit**: Notion page preview renders safely.

## Testing

- Fixture corpus: 50+ markdown samples with expected output.
- Injection harness: 20+ XSS vectors all neutralized.
- Perf: 100KB message renders in worker < 400ms; 1KB in sync < 5ms.
- Cache hit rate ≥ 95% after first render.

## Exit criteria

- [ ] Fixtures render correctly.
- [ ] Injection harness passes.
- [ ] Worker threshold tuned; main-thread unblocked on large payloads.
- [ ] Cache measurable (dev overlay shows hit/miss).

## Risks

| Risk | Mitigation |
|---|---|
| Sanitizer drift (allow vs deny) | Shared config + unit tests shared between streaming/full/cold |
| Worker initialization cost | Warm worker at app init; reuse |
| Large message streams completing causes GC spike | Render on idle callback; debounce post-completion |
| Mermaid/math extensions requested later | Plugin architecture — add via markdown-it plugin, re-sanitize per plugin |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §5.4 streaming strategy
- Plan 14 — hot/cold (consumer)
- Plan 16 — syntax highlight (hooks into rendered HTML)
