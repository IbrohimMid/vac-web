# Phase 1.5 — Web Scaffold + WebSocket Transport

**Duration**: 1.5 days
**Position**: after Phase 1.4 (auth ready); before Phase 1.6 (minimal UI)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Spin up the actual SPA that talks to the bridge: Vite + React scaffold beyond hello-world, single-WS-per-tab transport with RAF-batched event queue, auth exchange UI, reconnect + replay. No content rendering yet — just the transport substrate.

## Entry criteria

- Phase 1.4: pairing flow working end-to-end from bridge side.
- Phase 0.6-03 complete: `pnpm install` works, TS types build.

## Scope

### In
- React 18 + Vite + Zustand baseline.
- Single WS connection per tab, multiplexes sessions.
- RAF-batched event queue drain.
- Per-session queue cap 200 → triggers `client.throttle`.
- Auth: first-load prompts for pair code, exchanges for JWT, stores in localStorage.
- Reconnect: exponential backoff 1/2/5/10/30s; `last_event_id` replay.
- Heartbeat 20s / 40s timeout.
- `client.throttle` handler pauses transient events.
- `<PairingPrompt/>`, `<BridgeStatus/>` components.

### Out
- Transcript / composer / palette (Phase 1.6).
- Any workbench tab (Phase 3).
- React 19 migration (future; architecture already ready).

## Granular plan

Follows [`docs/plans/phase-1/12-web-scaffold-transport.md`](../phase-1/12-web-scaffold-transport.md).

## Day-by-day

### Day 1 — WS client + auth
- `BridgeWs` class: connect, hello, handle close, subprotocol auth token.
- `TokenStore`: access + refresh in localStorage.
- `<PairingPrompt/>`: input pair code, POST to `/api/pair/exchange`.
- `<BridgeStatus/>`: bottom-right indicator.

### Day 2 — Event queue + reconnect
- `EventQueue` per-session with RAF drain loop.
- `Correlator`: pending command IDs, resolve on ack, timeout 30s.
- `Reconnector` with backoff + `last_event_id` replay request.
- `Heartbeat` ping task.
- Backpressure listener: mute activity stream on `client.throttle`.
- Stress test: 10k events/s sustained; 60fps maintained.

## Deliverables

```
apps/web/src/
├── transport/
│   ├── ws.ts
│   ├── envelope.ts
│   ├── auth.ts
│   ├── queue.ts
│   ├── correlation.ts
│   ├── reconnect.ts
│   ├── heartbeat.ts
│   └── backpressure.ts
├── stores/
│   ├── session.ts
│   └── transport.ts
└── app/
    ├── shell.tsx
    ├── PairingPrompt.tsx
    └── BridgeStatus.tsx
```

## Exit criteria (gate to Phase 1.6)

- [ ] Fresh load → pair code entry → JWT received → status green.
- [ ] Disconnect mid-session + reconnect → no event loss, no duplicates.
- [ ] 10k events/s stress → FPS ≥ 50, no dropped frames.
- [ ] Memory: no listener leak after 100 reconnect cycles.
- [ ] Commander timeout surfaces to UI as toast.

## Risks

| Risk | Mitigation |
|---|---|
| RAF starves when tab inactive | Acceptable for v1; tab hidden = user not watching |
| Queue cap too low/high | Configurable; tune from perf tests (Phase 2) |
| Token expires mid-reconnect | Refresh before attempting reconnect |
| Browser-specific WS quirks | Test Chrome + Firefox + Safari in CI matrix (Phase 6) |

## Related

- [Plan 12 — web scaffold](../phase-1/12-web-scaffold-transport.md)
- [`docs/frontend-rules.md §10`](../../frontend-rules.md) — transport rules
- Phase 0.6-03 — pnpm + TS build verification

## Handoff to Phase 1.6

Phase 1.6 mounts the first user-facing content (transcript + composer) on top of this transport. Key APIs consumed:
- `transport.send(sessionId, type, payload)` → ack promise.
- `queue.on(type, handler)` → event subscription.
- Session store for current session id.
