# Phase 1.6 — Minimal Transcript + Composer

**Duration**: 1.5 days
**Position**: after Phase 1.5 (transport); before Phase 1.7 (E2E + red-team expansion)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Render a real (if ugly) conversation. User types → bridge forwards to engine → streaming response appears. No markdown, no syntax highlight, no virtualization — just proof the whole stack works visibly.

## Entry criteria

- Phase 1.5 exit: WS transport working; JWT + reconnect + replay verified.
- Mock-engine still the backend (upstream VAC PR #1 not strictly required yet; mock provides scripted streaming).

## Scope

### In
- `transcript` store: Map<MessageId, Message>; `order` array.
- `streaming` store: per-message delta buffer; RAF-batched flush.
- `composer` store: input, submitting flag.
- `<Transcript/>`: flat render (no virtualization; Phase 2 adds hot/cold).
- `<MessageRow/>`: per-message selector; plain text render.
- `<Composer/>`: textarea + submit + cancel.
- `<SessionPicker/>`: pick project from allowlist, create session.
- `transcript.delta` / `.message_added` / `.completed` / `.error` handlers.
- Stick-to-bottom scroll behavior (100px threshold).

### Out
- Markdown rendering (Phase 2.1).
- Syntax highlight (Phase 2.1).
- Hot/cold window freeze (Phase 2.1).
- Slash commands / @mentions (Phase 2.2, 3.2).
- Command palette (Phase 2.2).

## Granular plan

Follows [`docs/plans/phase-1/13-web-transcript-composer-mvp.md`](../phase-1/13-web-transcript-composer-mvp.md).

## Day-by-day

### Day 1 — Stores + rendering
- Domain stores (transcript, streaming, composer).
- FlushScheduler (RAF, 33ms min interval).
- Event handlers from transport queue.
- `<MessageRow/>`, `<Transcript/>`.

### Day 2 — Composer + session lifecycle
- `<Composer/>`: submit on Enter, cancel on Ctrl+C.
- `<SessionPicker/>`: list projects, pick, create session.
- Error handling: disconnection banner, ack error toasts.
- React profiler check: delta into message A does not rerender message B row.

## Deliverables

```
apps/web/src/
├── stores/
│   ├── transcript.ts
│   ├── streaming.ts
│   └── composer.ts
├── domain/transcript/
│   ├── hooks.ts
│   └── handlers.ts
├── components/
│   ├── Transcript/
│   │   ├── Transcript.tsx
│   │   └── MessageRow.tsx
│   ├── Composer/
│   │   └── Composer.tsx
│   └── SessionPicker/
│       └── SessionPicker.tsx
```

## Exit criteria (gate to Phase 1.7)

- [ ] E2E: fresh page → pair → pick project → submit prompt → stream visible.
- [ ] Cancel stream works.
- [ ] Session resume (list → pick) populates transcript.
- [ ] React DevTools profiler: delta targets only one MessageRow.
- [ ] No console errors on happy path.

## Risks

| Risk | Mitigation |
|---|---|
| Temptation to add markdown here | Explicit out-of-scope; Phase 2.1 owns |
| Scroll jitter at 500 tokens/s | RAF batching + stick-to-bottom threshold |
| Cold-start feels slow | Acceptable for 1.6; Phase 2 perf tuning |

## Related

- [Plan 13 — transcript + composer MVP](../phase-1/13-web-transcript-composer-mvp.md)
- [`docs/frontend-rules.md §5`](../../frontend-rules.md) — transcript architecture (structure here prepares Phase 2)

## Handoff to Phase 1.7

Phase 1.7 integrates everything into a green E2E path + expands red-team coverage across the full stack (bridge + client). Primary check: the stack runs a full scripted scenario without developer intervention.
