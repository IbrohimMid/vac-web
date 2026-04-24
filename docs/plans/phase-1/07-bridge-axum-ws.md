# Plan 07 — Bridge axum server + WebSocket

**Phase**: 1 · **Depends on**: Plans 05, 06 (PR #1 merged) · **Blocks**: 08, 09, 10, 11 · **Est**: 2 days

## Goal

Stand up the HTTP + WebSocket surface of `local-bridge`. No business logic yet — just plumbing that a client can connect to, send framed envelopes, receive responses, and reconnect gracefully.

## Why this is hard

WebSocket lifecycle + concurrency in Rust is full of footguns: frame fragmentation, backpressure, close-initiation asymmetry, TLS (when remote), and integration with axum's state management. Get the shape right now; changing it later when session manager + translator are attached is expensive.

## Scope

### In
- axum `Router` with `/api/*` routes.
- WS upgrade at `/api/sessions/stream` (multiplex sessions in a single socket).
- Envelope framing + discriminator decode via `protocol-rs`.
- Connection lifecycle (handshake, ping/pong, close).
- `last_event_id` replay cursor (buffer stub; filled by Plan 08).
- Embedded SPA serving via `rust-embed`.

### Out
- Session spawning (Plan 08).
- Translator content (Plan 09).
- Profile enforcement (Plan 10).
- Auth details (Plan 11).

## Deliverables

```
apps/local-bridge/src/
├── main.rs
├── server.rs               # router setup, state
├── ws/
│   ├── mod.rs
│   ├── handler.rs          # upgrade + per-connection loop
│   ├── envelope.rs         # serde parse into typed Command/Event
│   ├── framing.rs          # chunking large messages if needed
│   └── backpressure.rs     # send queue cap + coalesce hook
├── assets.rs               # rust-embed glue
└── health.rs
```

## Stages

### S1 — Router + state (0.3 day)

```rust
#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<SessionRegistry>,   // stub for now
    pub clients:  Arc<ClientRegistry>,
    pub started_at: Instant,
    pub version: &'static str,
}
```

Routes:
- `GET /health` → uptime, version.
- `GET /version` → bridge + engine version declarations.
- `POST /api/pair` → stub returning `501 Not Implemented`.
- `GET /api/sessions/stream` → WS upgrade (entry point).
- `GET /*` → serve embedded SPA.

`tower_http::trace::TraceLayer` for request logging (JSON to stderr).

**Exit**: `curl /health` + `curl /version` work; SPA loads at `/`.

### S2 — WS handshake (0.4 day)

In `ws/handler.rs`:
- Upgrade via axum's `WebSocketUpgrade`.
- On open: expect first frame `{"type":"hello","protocolVersion":1,"clientInfo":{...}}` within 5s or close.
- Respond with `welcome` envelope including bridge version, supported profiles, capabilities.
- Register connection in `ClientRegistry` keyed by random `client_id`.
- Spawn two tasks per connection: inbound reader, outbound writer (via `mpsc::Sender`).

Inbound reader loop:
- Text frame → parse via `serde_json::from_str::<CommandEnvelope>`.
- On parse error: send `{ackOf: null, ok: false, error: {code: "protocol.bad_envelope", ...}}`, continue.
- On known command: route to handler (stub).

Outbound writer loop:
- Receives `Event` or `Ack` from `mpsc::Receiver`.
- Serialize + send.
- On error: close connection, log.

**Exit**: wscat can connect, send hello, receive welcome, send unknown command, receive error ack.

### S3 — Ping/pong + close (0.2 day)

- Server-initiated ping every 20s.
- Track last pong; if > 40s, close with `1011 Going Away`.
- Handle client close: cleanup client registration, drop any per-client state (not session state — that survives disconnection).

**Exit**: idle connection survives > 60s with pings; stalled client disconnected at 40s.

### S4 — Envelope decode + `protocol-rs` integration (0.3 day)

`ws/envelope.rs`:
```rust
#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Command {
    #[serde(rename = "system.ping")]
    Ping,
    #[serde(rename = "session.create")]
    SessionCreate(SessionCreatePayload),
    // ... all v1 types
}
```

Most types come from codegen (`protocol-rs`); `envelope.rs` only adds the outer envelope wrap (`id`, `sessionId`, `v`).

Match to dispatcher:
```rust
match cmd {
    Command::Ping => send_event(Event::Pong(...)).await,
    Command::SessionCreate(p) => state.sessions.create(p).await,
    _ => NotYetImplemented,
}
```

**Exit**: every v1 command deserializes without error from sample fixtures.

### S5 — Per-session event ring + replay stub (0.3 day)

Replay cursor API (used fully by Plan 08, scaffolded here):
```rust
pub struct EventRing {
    buffer: VecDeque<(u64, Event)>,
    cap: usize,
}
impl EventRing {
    pub fn push(&mut self, seq: u64, ev: Event);
    pub fn replay_after(&self, last_event_id: u64) -> ReplayResult;
}
```

Handle `replay.request` frame: resolve session, call `replay_after`, stream matching events or `replay.out_of_range`.

Cap 5000 events per session.

**Exit**: unit test: push 6000 events, replay from 100, receive 4900 events or `out_of_range`.

### S6 — Backpressure hook (0.2 day)

Per-client outbound queue cap 200. On overflow:
- Send `client.throttle` event to client.
- Drop further events with specific transient types (e.g., `activity.appended`); but never drop stateful events (approval.pending, handoff.*).
- Escalate: if cap exceeded > 30s, close connection with `1013 Try Again Later`.

Stub coalescing hook: Plan 09 implements real transcript delta concat; here just define trait.

**Exit**: synthetic flood test: 10k events/s, client slow reader, bridge survives without OOM; throttle event observed.

### S7 — Embedded SPA (0.2 day)

```rust
#[derive(rust_embed::RustEmbed)]
#[folder = "../web/dist/"]
struct SpaAssets;

async fn serve_spa(uri: Uri) -> impl IntoResponse { ... }
```

Dev mode: if `VAC_WEB_DEV=1`, redirect to `http://localhost:5173` instead.

**Exit**: `cargo run -p local-bridge --release` serves SPA from single binary.

### S8 — Tests + integration (0.3 day)

- Unit: envelope decode round-trip.
- Integration (Tokio + async): connect WS, go through hello/welcome, send command, assert reply.
- Stress: 50 concurrent clients, each sending + receiving 100 msgs/s for 30s, no crash, no listener leak.

**Exit**: `cargo test -p local-bridge` green; stress test passes.

## Testing

Beyond stage tests: fuzz envelope parser with `cargo-fuzz` against malformed JSON — assert no panic, only clean errors.

## Exit criteria

- [ ] wscat smoke test documented in README.
- [ ] All v1 command envelopes deserialize.
- [ ] Ping/pong + 40s timeout working.
- [ ] Replay stub ring buffer tested.
- [ ] SPA served from binary (release build).
- [ ] Stress test passes.

## Risks

| Risk | Mitigation |
|---|---|
| `serde_json` slow on hot path | Benchmark; if >5% frame time, move to `simd-json` for inbound |
| Axum upgrade + state sharing quirks | Use `State<Arc<AppState>>` pattern; avoid per-request clone of heavy things |
| Client registry leak on disconnect | Drop guard pattern; integration test asserts count returns to baseline |
| Large messages (snapshots) fragment | Enable `WebSocket::max_message_size`; plan chunked framing if needed |

## Related

- [`protocol.md`](../../protocol.md) §1–§2 — envelope + handshake
- [`architecture.md`](../../architecture.md) §3, §8–§9 — transport + multi-client + replay
- Plan 08 — session manager (consumes registry)
- Plan 09 — translator (consumes decoded commands)
