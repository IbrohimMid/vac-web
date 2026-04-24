# Plan 12 — Web scaffold + WS transport + RAF drain

**Phase**: 1 · **Depends on**: Plan 05, 07, 11 · **Blocks**: 13, Phase 2 · **Est**: 1.5 days

## Goal

Stand up the SPA transport layer that can connect, auth, send commands, receive events with RAF-batched drain, reconnect with `last_event_id` replay. No UI beyond a skeleton shell.

## Why this is hard

The transport is the load-bearing floor for every feature above. Bugs here (dropped events, listener leaks, ordering violations) compound across the whole app. Also — WebSocket reconnection logic is deceptively tricky: token refresh, session state preservation, queue drain, UI state "soft reset."

## Scope

### In
- Single WebSocket per tab.
- Auth: JWT from localStorage; refresh flow.
- Inbound event queue per session + RAF drain.
- Outbound command send with ack correlation.
- Reconnect with backoff + `last_event_id`.
- Heartbeat.
- Backpressure signal handler.

### Out
- Any actual UI components beyond app shell (Plan 13).
- Pairing UI (Plan 29 brings it in with Readiness Hub; v1 uses CLI-printed code).

## Deliverables

```
apps/web/src/transport/
├── index.ts
├── ws.ts                  # single WS connection
├── envelope.ts            # typed send/recv helpers
├── auth.ts                # JWT storage, refresh
├── queue.ts               # per-session RAF-drained queues
├── correlation.ts         # command id → ack Promise
├── reconnect.ts           # backoff + resume
├── heartbeat.ts
└── backpressure.ts
apps/web/src/stores/
├── session.ts
└── transport.ts           # connection status slice
apps/web/src/app/
├── shell.tsx
├── PairingPrompt.tsx
└── BridgeStatus.tsx
```

## Stages

### S1 — WS client + auth (0.3 day)

```ts
export class BridgeWs {
  private ws?: WebSocket;
  private handlers: EventHandlerMap;
  constructor(private url: string, private tokenStore: TokenStore) {}
  async connect(): Promise<void> {
    const token = await this.tokenStore.getAccess();
    this.ws = new WebSocket(this.url, [`bearer.${token}`]);
    this.ws.onopen = () => this.sendHello();
    this.ws.onmessage = (e) => this.handleFrame(e);
    this.ws.onclose = (e) => this.onClose(e);
  }
  // ...
}
```

Auth: JWT from `localStorage['vac_web_access']`; auto-refresh when `exp - now < 60s`. Refresh endpoint `POST /api/auth/refresh`.

**Exit**: browser devtools shows WS connecting with subprotocol; hello/welcome round-trip works.

### S2 — Envelope helpers + type narrowing (0.2 day)

```ts
export type Command = { id: string; sessionId: string; type: CommandType; payload: CmdPayload; v: 1 };
export type Event = { seq: number; sessionId: string; type: EventType; payload: EvtPayload; v: 1; ts: string };
export type Ack = { ackOf: string; ok: boolean; error?: ErrorInfo };

export function isEvent<T extends EventType>(e: Event, type: T): e is Event & { type: T, payload: EvtPayloadFor<T> };
```

Types come from `protocol-ts` codegen. Helpers add narrowing discipline.

**Exit**: TypeScript strict mode catches mismatched payloads.

### S3 — Per-session event queue + RAF drain (0.4 day)

```ts
class EventQueue {
  private queues = new Map<SessionId, Event[]>();
  private maxPerSession = 200;
  private rafScheduled = false;

  enqueue(ev: Event) {
    const q = this.queues.get(ev.sessionId) ?? [];
    q.push(ev);
    this.queues.set(ev.sessionId, q);
    if (q.length > this.maxPerSession) this.signalBackpressure(ev.sessionId);
    if (!this.rafScheduled) {
      this.rafScheduled = true;
      requestAnimationFrame(() => this.drain());
    }
  }

  private drain() {
    for (const [sid, q] of this.queues) {
      if (q.length === 0) continue;
      const batch = q.splice(0, q.length);
      for (const ev of batch) this.dispatch(ev);
    }
    this.rafScheduled = false;
    if (this.anyNonEmpty()) requestAnimationFrame(() => this.drain());
  }
}
```

Dispatch calls registered handler per event type; handlers call store actions.

**Exit**: flood test — 10k events/s → FPS stays ≥ 50; no `setState` per event.

### S4 — Command send + ack correlation (0.2 day)

```ts
async send<C extends CommandType>(sessionId: SessionId, type: C, payload: CmdPayloadFor<C>): Promise<Ack> {
  const id = ulid();
  const env: Command = { id, sessionId, type, payload, v: 1 };
  const promise = this.correlator.register(id, 30_000);
  this.ws!.send(JSON.stringify(env));
  return promise;
}
```

Correlator:
```ts
class Correlator {
  private map = new Map<string, { resolve; reject; timeout }>();
  register(id, ttlMs): Promise<Ack> { ... }
  resolve(ack: Ack) { ... }
  onDisconnect() { /* reject all pending with 'disconnected' */ }
}
```

**Exit**: send command → receive ack; timeout after 30s → rejection.

### S5 — Reconnect + replay (0.3 day)

```ts
class Reconnector {
  private attempt = 0;
  private readonly delays = [1000, 2000, 5000, 10000, 30000];

  async onClose(code: number) {
    await this.sleep(this.delays[Math.min(this.attempt, this.delays.length-1)]);
    this.attempt++;
    try {
      await this.ws.connect();
      this.attempt = 0;
      for (const [sid, cursor] of this.cursors) {
        await this.ws.send(sid, 'replay.request', { lastEventId: cursor });
      }
    } catch (e) { /* retry */ }
  }
}
```

`cursors`: per-session last seq seen. Replay response either streams events with seq > last, or server sends `replay.out_of_range` + fresh `session.snapshot`.

Handle `replay.out_of_range` by resetting session store → apply snapshot → resume.

**Exit**: disconnect mid-stream → reconnect → no duplicate events, no missing deltas (verified via seq continuity).

### S6 — Heartbeat (0.1 day)

Send ping every 20s; on 40s without frame, force reconnect.

**Exit**: simulated network stall triggers reconnect.

### S7 — Backpressure (0.1 day)

Listen for `client.throttle` event from bridge. Response:
- Pause emitting `activity.appended` locally (store still accepts; just no UI update).
- Show subtle "catching up" indicator.

On queue normal: resume.

**Exit**: under stress, throttle observed in devtools; UI stays responsive.

### S8 — App shell + BridgeStatus (0.2 day)

`app/shell.tsx`: top-level layout with header slot, main slot. Initially just shows connection status.

`BridgeStatus.tsx`: bottom-right indicator, WS state color-coded (green=connected, amber=reconnecting, red=failed), click → open connection panel with recent errors.

`PairingPrompt.tsx`: when no valid JWT, prompt for code paired from CLI.

**Exit**: fresh load → pairing prompt → enter code → status goes green.

## Testing

- Unit: Correlator resolves + rejects.
- Unit: EventQueue RAF drain order.
- Integration (Playwright): connect + reconnect + replay.
- Perf: 10k events/s stress doesn't drop frames.

## Exit criteria

- [ ] Fresh user → paired → connected in ≤ 3 clicks.
- [ ] Reconnect after 10s offline: no event loss, no duplicates.
- [ ] 10k events/s sustained, FPS ≥ 50.
- [ ] Memory: no listener leak after 100 reconnects.
- [ ] Command correlation timeout + rejection works.

## Risks

| Risk | Mitigation |
|---|---|
| RAF drain starves if tab inactive | OK for v1 (tab hidden = user not watching); revisit if needed |
| Queue cap too low/high | Configurable; tune from perf tests |
| JWT expires mid-reconnect | Refresh before connect attempt |
| Event ordering violated by RAF batching | Events processed in arrival order within a session |

## Related

- [`frontend-rules.md`](../../frontend-rules.md) §10
- [`protocol.md`](../../protocol.md) §5 replay
- Plan 07 — bridge WS (server side)
- Plan 11 — pairing + JWT (server side)
- Plan 13 — first UI on top
