# Phase 1.1 — Bridge WebSocket Transport

**Duration**: 2–3 days
**Position**: after Phase 0.6 (integration substrate ready); before Phase 1.2 (session manager)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Stand up the axum WebSocket server inside `apps/local-bridge/`: accept browser connections, handshake, route envelopes through `bridge-core::EventRing`, serve embedded SPA. No session spawning yet (stubbed); no profile enforcement yet (stubbed). Prove the WS plumbing works end-to-end.

## Entry criteria

- Phase 0.6 exits: `mock-engine`, `bridge-core` (AuditWriter, EventRing, ResourceUsage, SessionState), integration roundtrip green, 75+ workspace tests passing.
- `protocol-rs` types import cleanly.

## Scope

### In
- `axum::Router` + `Server` on `127.0.0.1:<port>`.
- `/health`, `/version` endpoints (already stub; flesh out).
- `/api/sessions/stream` WS upgrade.
- Envelope decode via `protocol-rs` types.
- Handshake (`hello` → `welcome`).
- Ping/pong 20s; 40s timeout.
- Per-client outbound queue with cap 200 + backpressure signal.
- `replay.request` with `last_event_id` replay via bridge-core EventRing.
- Embed SPA via `rust-embed`; dev mode redirect to Vite.
- Stress: 50 concurrent clients.

### Out
- Session spawning (Phase 1.2 — stubbed as "fake session" here).
- Profile enforcement Layer 1 (Phase 1.3).
- Pairing + JWT (Phase 1.4; for now, allow any origin in dev).
- Multi-session multiplex (Phase 1.2).

## Granular plan

Follows [`docs/plans/phase-1/07-bridge-axum-ws.md`](../phase-1/07-bridge-axum-ws.md) verbatim. This README is the iteration wrapper.

## Day-by-day

### Day 1 — Router + handshake
- Scaffold axum app state (ClientRegistry stub, SessionRegistry stub).
- WS upgrade handler.
- Hello/welcome exchange.
- Graceful connection close.

### Day 2 — Envelope decode + event queue
- Wire `protocol-rs::Command` deserializer.
- Per-client tokio::mpsc outbound sender.
- Ping/pong timer (20s).
- `replay.request` routes to `EventRing` from stub session.

### Day 3 — SPA embed + stress + tests
- `rust-embed` SPA for release build.
- Dev mode env var `VAC_WEB_DEV=1` → redirect to vite.
- Stress test: 50 concurrent WS clients × 100 messages/sec for 30s.
- Integration test reusing `MockEngineHandle` pattern, now wrapping axum handle.

## Deliverables

```
apps/local-bridge/src/
├── main.rs                (expanded)
├── server.rs              # Router + state
├── ws/
│   ├── mod.rs
│   ├── handler.rs
│   ├── envelope.rs
│   ├── framing.rs
│   └── backpressure.rs
├── assets.rs              # rust-embed glue
└── health.rs
tests/integration/tests/ws_transport.rs
```

## Exit criteria (gate to Phase 1.2)

- [ ] `wscat ws://127.0.0.1:<port>/api/sessions/stream` succeeds; hello/welcome exchange works.
- [ ] 50-client stress test: no crash, FPS/throughput metrics within expectations.
- [ ] Replay scenario: client disconnects, reconnects with `last_event_id`, receives gap events.
- [ ] Release binary serves SPA from `/`.
- [ ] Fuzz: malformed JSON envelopes handled without panic.
- [ ] All 0.6 tests still passing; ≥ 8 new integration tests green.

## Risks (this sub-phase)

| Risk | Mitigation |
|---|---|
| axum + tokio-tungstenite integration quirks | Use axum's built-in `WebSocketUpgrade`; avoid bare tokio-tungstenite |
| Large messages fragment | Set `max_message_size` = 16MB; document |
| Ring buffer contention under load | Per-session Mutex; test with 10 concurrent subscribers |

## Related

- [Plan 07 — axum WS](../phase-1/07-bridge-axum-ws.md) (granular task view)
- [`docs/architecture.md §3`](../../architecture.md) — transport layers
- [`docs/protocol.md §1–§2`](../../protocol.md) — envelope + handshake

## Handoff to Phase 1.2

Phase 1.2 (session manager) plugs into:
- `ClientRegistry` (this phase owns; 1.2 extends to multi-session).
- `EventRing` per session (this phase: stub one; 1.2: per-spawn).
- Outbound backpressure API (this phase defines; 1.2 respects).
