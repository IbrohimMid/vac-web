# Plan 13 — Web minimal transcript + composer

**Phase**: 1 · **Depends on**: Plan 12 · **Blocks**: Phase 1 exit · **Est**: 1.5 days

## Goal

Render a functional (if minimal) conversation surface: user types in composer, sees streaming response. No markdown, no syntax highlight, no workbench — proof that the transport stack works end-to-end.

## Why this is hard

Easy to over-build here. The discipline is: ship the ugliest thing that proves the pipeline works. Phase 2 adds the polish.

## Scope

### In
- `transcript` store slice.
- `streaming` store slice (separate; critical for perf later).
- `composer` store slice.
- `<Transcript/>` — plain text, no virtualization yet.
- `<MessageRow/>` — plain rendering.
- `<Composer/>` — textarea + submit button.
- Streaming: deltas appended to message.
- Command: `message.submit`; cancel via `message.cancel_stream`.
- Session creation UI (pick project from allowlist).

### Out
- Slash commands (Plan 17 palette adds later).
- @mention (Plan 25).
- Markdown (Plan 15).
- Syntax highlight (Plan 16).
- Hot/cold freeze (Plan 14 — important: structure store so Plan 14 slots in cleanly).

## Deliverables

```
apps/web/src/
├── stores/
│   ├── transcript.ts
│   ├── streaming.ts
│   └── composer.ts
├── domain/
│   └── transcript/
│       ├── hooks.ts
│       └── handlers.ts       # register transport event handlers
├── components/
│   ├── Transcript/
│   │   ├── Transcript.tsx
│   │   └── MessageRow.tsx
│   ├── Composer/
│   │   └── Composer.tsx
│   └── SessionPicker/
│       └── SessionPicker.tsx
```

## Stages

### S1 — Stores (0.3 day)

`transcript.ts`:
```ts
interface TranscriptSlice {
  messages: Map<MessageId, Message>;
  order: MessageId[];
  activeMessageId: MessageId | null;
  hotWindowSize: 50;           // used later by Plan 14; noop for now
  upsertMessage(m: Message): void;
  completeMessage(id: MessageId, usage: TokenUsage): void;
}
```

`streaming.ts`:
```ts
interface StreamingSlice {
  buffers: Map<MessageId, { chunks: string[]; dirty: boolean }>;
  appendDelta(msgId: MessageId, delta: string): void;
  flushAll(): void;      // moves buffers into transcript.messages.content
}
```

**Critical**: streaming store is **separate** from transcript store. Components reading transcript don't re-render on streaming delta. Scheduler (next stage) moves delta chunks from streaming → transcript at flush time.

`composer.ts`: input text, submitting flag, attachments stub.

**Exit**: stores unit-tested; selector granularity correct.

### S2 — Flush scheduler (0.2 day)

```ts
class FlushScheduler {
  private rafId: number | null = null;
  private lastFlush = 0;
  private minInterval = 33; // ~30fps
  schedule() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => this.run());
  }
  private run() {
    const now = performance.now();
    if (now - this.lastFlush < this.minInterval) {
      this.rafId = requestAnimationFrame(() => this.run());
      return;
    }
    useStreamingStore.getState().flushAll();
    this.lastFlush = now;
    this.rafId = null;
  }
}
```

`flushAll` moves each dirty buffer's concat into transcript.messages[id].content. Dirty flag cleared.

**Exit**: 500 deltas/sec simulated; UI updates ≈ 30 times/sec; no jank.

### S3 — Event handlers (0.2 day)

`domain/transcript/handlers.ts`:
```ts
export function registerTranscriptHandlers(queue: EventQueue) {
  queue.on('transcript.message_added', (ev) => useTranscriptStore.getState().upsertMessage(...));
  queue.on('transcript.delta', (ev) => {
    useStreamingStore.getState().appendDelta(ev.payload.messageId, ev.payload.delta);
    scheduler.schedule();
  });
  queue.on('transcript.completed', (ev) => {
    useStreamingStore.getState().flushAll();
    useTranscriptStore.getState().completeMessage(ev.payload.messageId, ev.payload.usage);
  });
  queue.on('transcript.error', (ev) => { /* mark message error */ });
}
```

Called once at app init after transport ready.

**Exit**: deltas arriving cause content to appear; completed marker shown.

### S4 — `<MessageRow/>` (0.2 day)

```tsx
function MessageRow({ id }: { id: MessageId }) {
  const msg = useTranscriptStore(s => s.messages.get(id));
  if (!msg) return null;
  return (
    <div className={`message message-${msg.role}`}>
      <header>
        <span>{msg.role}</span>
        <time>{formatTs(msg.createdAt)}</time>
      </header>
      <pre className="whitespace-pre-wrap">{msg.content}</pre>
      {msg.state === 'streaming' && <StreamingIndicator />}
      {msg.state === 'error' && <ErrorBadge error={msg.error} />}
    </div>
  );
}
```

Selector scoped by `id` — only this row re-renders when that message updates. Verify with React DevTools Profiler.

**Exit**: streaming into one message does NOT rerender other rows.

### S5 — `<Transcript/>` (0.1 day)

```tsx
function Transcript() {
  const order = useTranscriptStore(s => s.order, shallow);
  return (
    <div className="transcript" ref={scrollRef}>
      {order.map(id => <MessageRow key={id} id={id} />)}
    </div>
  );
}
```

Stick-to-bottom: on new message added, scroll if user within 100px of bottom. Scroll ref tracks.

No virtualization yet — Plan 14.

**Exit**: messages in order, auto-scroll behaviour correct.

### S6 — `<Composer/>` (0.2 day)

```tsx
function Composer({ sessionId }) {
  const [value, setValue] = useState('');
  const submit = async () => {
    const ack = await transport.send(sessionId, 'message.submit', { text: value });
    if (!ack.ok) notify.error(ack.error);
    else setValue('');
  };
  const cancel = () => transport.send(sessionId, 'message.cancel_stream', { messageId: activeId });
  return (
    <div className="composer">
      <textarea value={value} onChange={...} onKeyDown={submitOnEnter} />
      <button onClick={submit}>Send</button>
      {streaming && <button onClick={cancel}>Stop</button>}
    </div>
  );
}
```

Disabled while submitting. Streaming indicator.

**Exit**: typing + Enter sends message; Stop cancels stream.

### S7 — Session picker (0.2 day)

On first load (post-pair), fetch project allowlist from bridge (`GET /api/projects`), show picker, call `session.create { projectRoot, profileId: 'executor.code@1.0.0' }`.

Store chosen session in `session.ts` slice. Composer binds to this session.

Session resume: list existing sessions (from `session.list`), offer resume.

**Exit**: pick project → see new session → send first message.

### S8 — Error UX (0.1 day)

Disconnection: banner at top. Error event: show in message row. Ack error: toast (transient).

**Exit**: kill bridge mid-stream; user sees clear error; reconnect restores.

## Testing

- Integration (Playwright): session create → message submit → receive delta → complete.
- Perf: 500 tokens/s streaming, FPS ≥ 55 (basic benchmark — full one in Phase 2).
- Unit: store reducers.

## Exit criteria

- [ ] E2E: user types question, sees streaming response.
- [ ] Cancel stream works.
- [ ] Session resume works.
- [ ] No console errors on normal flow.
- [ ] React profiler shows only target MessageRow re-rendering on delta.

## Risks

| Risk | Mitigation |
|---|---|
| Temptation to add markdown now | Explicit out-of-scope; Plan 15 owns it |
| Streaming flicker from too-fast flush | 30fps cap via minInterval |
| Scroll behaviour annoying (auto-scroll when reading old) | Stick-to-bottom only within 100px of bottom |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §5 transcript lifecycle (structure matters)
- Plan 12 — transport
- Plan 14 — hot/cold freeze (next, slots in cleanly)
- Plan 15 — markdown (after basic works)
