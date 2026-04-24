# Plan 14 — Transcript hot window + cold freeze

**Phase**: 2 · **Depends on**: Plan 13 · **Blocks**: 15, 16, Phase 2 exit · **Est**: 1.5 days

## Goal

Make the transcript survive long sessions. Only the last 50 messages render live React components; older completed messages freeze into static HTML + virtualize. This is the single most important perf decision in the app.

## Why this is hard

Freezing is a cliff: a message that was live becomes static. Any interaction (copy-code, link-click, rerender-trigger) must still work without a React component behind it. Plus: freezing mid-stream is forbidden; freeze only after `transcript.completed`. And: if user scrolls back to re-engage with an old message, we must support lazy un-freeze.

## Scope

### In
- Hot window of 50 live `<MessageRow/>`.
- Cold message store: pre-rendered HTML string.
- `<ColdMessage/>` using sanitized `dangerouslySetInnerHTML` + `React.memo`.
- Freeze trigger: exits window + state completed.
- Un-freeze on explicit action.
- TanStack Virtual for the outer list.
- Event delegation for copy / link interactions.

### Out
- Markdown rendering itself (Plan 15).
- Syntax highlight (Plan 16).
- Per-message perf budgets (handled by Plan 33 bench).

## Deliverables

```
apps/web/src/
├── stores/transcript.ts              # upgraded with hot/cold
├── components/Transcript/
│   ├── Transcript.tsx                # now virtualized
│   ├── MessageRow.tsx                # hot variant
│   ├── ColdMessage.tsx               # frozen variant
│   ├── FreezeController.ts           # decides when to freeze
│   ├── EventDelegation.ts            # copy/link handlers
│   └── renderToHTML.ts               # sanitized HTML generator
```

## Stages

### S1 — Store upgrade (0.3 day)

Add to `transcript.ts`:
```ts
interface Message {
  id: MessageId;
  role: 'user' | 'assistant' | 'tool';
  content: string;               // raw
  renderedHTML?: string;         // cold frozen HTML; set on freeze
  state: 'streaming' | 'completed' | 'error';
  isCold: boolean;
  ...
}

interface TranscriptSlice {
  ...
  hotWindowIds: Set<MessageId>;     // last 50 non-cold
  freeze(id: MessageId): void;
  unfreeze(id: MessageId): void;
}
```

Freeze operation:
1. Assert message is `completed`.
2. Call `renderToHTML(message)` (Plan 15 handles the actual render; for now, plain-text wrapping is fine).
3. Store in `renderedHTML`; set `isCold: true`.
4. Remove from `hotWindowIds`.
5. Clear any attached React-only metadata (e.g., cached computed fields).

**Exit**: freeze flag flips; no component crashes.

### S2 — FreezeController (0.2 day)

Decides when to freeze. Runs after transcript mutations:
```ts
function evaluateFreeze() {
  const { order, messages, hotWindowIds } = useTranscriptStore.getState();
  const completed = order
    .map(id => messages.get(id)!)
    .filter(m => m.state === 'completed' && !m.isCold);
  while (hotWindowIds.size > 50 && completed.length > 0) {
    const oldest = completed.shift()!;
    useTranscriptStore.getState().freeze(oldest.id);
  }
}
```

Triggered: after `transcript.completed` handler; idle-callback throttle 500ms to avoid churn during bursts.

**Exit**: 60-message session → 10 oldest are cold; last 50 hot.

### S3 — `<ColdMessage/>` (0.3 day)

```tsx
const ColdMessage = React.memo(function ColdMessage({ id }: { id: MessageId }) {
  const html = useTranscriptStore(s => s.messages.get(id)?.renderedHTML);
  if (!html) return null;
  return (
    <div
      className="message message-cold"
      data-msg-id={id}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, () => true);   // never rerender unless key changes
```

`React.memo` with `always-true` comparator: once mounted, only unmount/remount cycles. The `data-msg-id` attribute is needed for event delegation.

**Exit**: cold message mounted → React DevTools shows 0 rerenders even on unrelated store updates.

### S4 — `renderToHTML` with DOMPurify (0.2 day)

```ts
import DOMPurify from 'isomorphic-dompurify';

export function renderToHTML(msg: Message): string {
  // Phase 2: plain-text + line breaks + fenced code detection.
  // Plan 15 replaces with full markdown-it.
  const body = escape(msg.content).replace(/\n/g, '<br>');
  const raw = `<div class="message-body">${body}</div>`;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['p', 'a', 'strong', 'em', 'code', 'pre', 'h1','h2','h3','h4','h5','h6',
                   'ul','ol','li','blockquote','img','span','div','table','thead','tbody',
                   'tr','td','th','hr','br'],
    ALLOWED_ATTR: ['href','src','alt','title','class'],
    FORBID_ATTR: ['style','onerror','onload','onclick'],  // belt + suspenders
    ALLOW_DATA_ATTR: true,
  });
}
```

Same config used in Plan 15 markdown path; extract to `markdown/sanitize.ts` so both callers share.

**Exit**: unit test: injection attempts (`<script>`, `onerror`, `javascript:`) neutralized.

### S5 — Virtualization (0.3 day)

Switch `<Transcript/>` to TanStack Virtual:
```tsx
const virtualizer = useVirtualizer({
  count: order.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 200,
  overscan: 5,
  getItemKey: (i) => order[i],
});
```

Dynamic row height: each row reports measured height via `virtualizer.measureElement`.

Sticky bottom: on new append, if user within 100px, programmatic scroll to bottom.

**Exit**: 10k messages virtual list; scroll smooth; only visible rows in DOM.

### S6 — Event delegation (0.2 day)

Single root-level delegate for cold message interactions:
```ts
scrollRef.current.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('.copy-code-btn')) {
    const pre = target.closest('pre');
    navigator.clipboard.writeText(pre!.innerText);
  }
  if (target.matches('a[href]')) {
    // ... link handling
  }
});
```

Reason: cold messages don't have React event handlers; delegation on parent serves all.

**Exit**: copy button in cold code block works.

### S7 — Un-freeze on demand (0.1 day)

User triggers "Re-render" (e.g., for copy-structured, or a re-parse after connector data updated). Freeze reverses: `isCold = false`, message joins hot window again. Oldest hot message evicted if needed.

UI: context menu on cold message → "Re-render".

**Exit**: un-freeze restores to hot state; subsequent live updates work.

### S8 — Memory & GC verification (0.2 day)

Heap snapshot in dev mode shows:
- React fiber tree size proportional to hot window, not total messages.
- HTML strings retained only for cold messages.
- No listener leak: adding + removing 1000 messages, listener count stable.

**Exit**: bench passes target from `perf-test-plan.md §3.1`.

## Testing

- Unit: freeze / un-freeze store reducers.
- DOMPurify: injection harness.
- Integration: 10k-message simulated session; measure React fiber count, DOM node count.
- `bench:transcript` full run.

## Exit criteria

- [ ] 10k-message session: active DOM ≤ 8k, hot rows ≤ 50.
- [ ] Cold messages never rerender (React profiler confirmed).
- [ ] Injection harness passes.
- [ ] Scroll smooth; FPS ≥ 50 during stream + scroll.
- [ ] Un-freeze works.

## Risks

| Risk | Mitigation |
|---|---|
| Premature freeze on streaming message | Assert `state === 'completed'`; test edge |
| DOMPurify false positive blocking valid content | Config tested with legitimate markdown fixtures |
| Event delegation misses edge in cold HTML | Keep delegation targets narrow (button classes, `a[href]`) |
| Virtual list "jumpy" on dynamic heights | Debounce measure updates; cap frequency |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §5 — this is the authoritative spec
- [`perf-test-plan.md`](../../perf-test-plan.md) §3.1
- Plan 13 — upstream
- Plan 15 — markdown replaces S4's stub
