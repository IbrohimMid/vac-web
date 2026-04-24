# Plan 09 — Bridge translator (protocol ↔ JSON-RPC)

**Phase**: 1 · **Depends on**: Plans 07, 08 · **Blocks**: all feature work · **Est**: 1.5 days

## Goal

Translate between the WS-facing semantic protocol v1 and the stdio JSON-RPC that `vac serve` speaks. This is where shape adaptation happens (envelope wrap/unwrap, field renames, event correlation, coalescing).

## Why this is hard

The bridge is not a dumb pipe. It:
- Strips `sessionId` on the way to the engine (stdio is single-session).
- Correlates commands and acks.
- Injects bridge-only events (e.g., `session.ready` after spawn).
- Coalesces transcript deltas per backpressure policy.
- Translates approval flow (bridge owns approval UI events; engine only knows approve/reject).
- Maintains OverlayManager state for multi-client sync (engine doesn't know about overlays).

## Scope

### In
- Command → JSON-RPC request mapping.
- Event → JSON-RPC notification mapping (reverse).
- Ack correlation.
- Coalescing `transcript.delta` per session budget.
- Bridge-injected events (session lifecycle, overlay state).
- Simple pass-through for most events.

### Out
- Profile enforcement (Plan 10).
- Assessment-specific translation (Plan 26).
- Handoff-specific translation (Plan 32).

## Deliverables

```
apps/local-bridge/src/translator/
├── mod.rs
├── cmd_to_rpc.rs       # command → engine
├── rpc_to_event.rs     # engine → event
├── coalesce.rs         # transcript delta coalescing
├── correlation.rs      # command id ↔ ack tracking
└── injected.rs         # bridge-originated events
```

## Stages

### S1 — Command → JSON-RPC mapping table (0.3 day)

For each v1 command, define the mapping:

```rust
fn cmd_to_rpc(cmd: &CommandEnvelope) -> JsonRpcRequest {
    match &cmd.payload {
        Command::MessageSubmit(p) => JsonRpcRequest {
            method: "message.submit".into(),
            params: json!({"text": p.text, "mentions": p.mentions, ...}),
        },
        Command::ApprovalApprove(p) => JsonRpcRequest {
            method: "approval.approve".into(),
            params: json!({"approval_id": p.approval_id}),
        },
        // Overlay / workbench.select_tab: NOT forwarded (bridge-local state)
        Command::OverlayOpen(_) | Command::OverlayDismiss(_) => return ...bridge-only...,
        // ...
    }
}
```

Document which commands are:
- **Forwarded**: engine-owned (message.submit, approval.*, plan.*, review.*, ...).
- **Bridge-local**: UI state (overlay.*, workbench.select_tab, palette multiplex).
- **Split**: partially handled (session.create — bridge spawns; engine initializes).

**Exit**: table reviewed; every v1 command categorized.

### S2 — JSON-RPC notification → event (0.3 day)

Inverse mapping, most are pass-through. Tricky ones:
- Engine's internal tool-call event → bridge may inject profile-enforcement metadata before forwarding.
- Approval sequencing: engine emits `approval.pending`; bridge adds correlation id + broadcasts to subscribers.

Pass-through list vs injected list documented.

**Exit**: every engine event mapped or explicitly dropped.

### S3 — Command correlation (0.2 day)

Commands have `id`; engine RPC has request id; need bidirectional map.
```rust
struct Correlation {
    pending: DashMap<RpcId, CommandId>,
}
```
On RPC response: look up command id, emit `Ack { ackOf: command_id, ok, error? }` to client.

Timeout: 30s default; expired correlations emit ack with `error: { code: "internal.rpc_timeout" }`.

**Exit**: unit test: send 10 commands, receive 10 acks in arbitrary order, all correlate.

### S4 — Transcript delta coalescing (0.3 day)

Per session: track inflight delta buffer for each `messageId`.
- Sliding window: flush every 16ms (aligned to client RAF) OR when buffer > 4KB.
- If subscriber slow (throttle signal from Plan 07): flush less often (60ms).
- Always concat `delta` strings; never drop.
- Assign single `seq` to coalesced event.

Measure: emitted delta event rate per session; enforce ≤ 60/s.

**Exit**: test — inject 1000 1-char deltas in 1s; verify ≤ 60 output events with full concat.

### S5 — Bridge-injected events (0.2 day)

Events the engine doesn't know about:
- `session.ready` after successful spawn + handshake.
- `overlay.opened` / `overlay.dismissed` — bridge owns stack.
- `system_pulse.updated` — bridge aggregates from engine state + its own metrics.
- `gate.state_changed` — from Plan 30's gate evaluator.
- Connector lifecycle — bridge-owned.

Each emission goes through same broadcast + ring path; same `seq` space.

**Exit**: test sessions show appropriate injected events during lifecycle.

### S6 — OverlayManager state (0.2 day)

Per-session overlay stack in bridge:
- On `overlay.open` command: push to stack, emit `overlay.opened`.
- On `overlay.dismiss`: pop specified id, emit `overlay.dismissed`.
- On `overlay.dismiss_all`: clear, emit per-id dismissals.
- Stack depth max 2: opening a 3rd dismisses bottom.
- Serializable: included in `session.snapshot` so new client resyncs.

**Exit**: multi-client test: client A opens overlay → both clients see `overlay.opened`.

### S7 — Error envelope normalization (0.2 day)

Engine may emit errors in various shapes; normalize to `protocol.md §1` error structure:
```json
{"ackOf": "...", "ok": false, "error": {"code": "...", "message": "...", "details": {...}}}
```

Map engine error categories to v1 codes. Unknown → `internal`.

**Exit**: error fuzz — every engine error shape produces valid v1 ack.

## Testing

- End-to-end: client command → translator → mock engine → translator → client ack/event.
- Coalescing benchmark.
- Multi-client overlay sync.
- Correlation timeout.

## Exit criteria

- [ ] Every v1 command + event handled (pass-through, bridge-local, or split).
- [ ] Transcript coalescing ≤ 60 events/s at high delta rate.
- [ ] Overlay stack consistent across multi-client.
- [ ] Correlation timeout + error normalization working.

## Risks

| Risk | Mitigation |
|---|---|
| Silent drop of unknown engine event | Default case logs + emits `notify.event warn`, doesn't drop silently |
| Coalescing loses ordering | Per-message buffer is FIFO; seq monotonic across messages |
| Bridge-local state diverges from client expectation on reconnect | Replay via `session.snapshot` resync |
| Field rename between versions | Version negotiation at handshake; v1 pinned |

## Related

- [`protocol.md`](../../protocol.md) §1, §6 — envelope, coalescing
- [`architecture.md`](../../architecture.md) §3 — transport layers
- Plan 07 — WS transport (upstream)
- Plan 08 — session manager (upstream)
- Plan 10 — profile enforcement wraps this
