# `bridge-core`

Transport-agnostic primitives for `apps/local-bridge` and `tests/integration`.

No HTTP/WS here — pure state + helpers. Unit-testable without spinning up axum.

## Surface

- `AuditWriter` — non-blocking JSONL writer spawned as tokio task; `try_send` drops on overflow.
- `EventRing<T>` — bounded ring buffer for per-session replay; `ReplayResult::{Stream, OutOfRange, UpToDate}`.
- `ResourceUsage` — atomic counters (tool calls, children, wallclock) with enforced limits; `ChildGuard` RAII.
- `SessionState` + `StateHolder` — enum + thread-safe transition matrix.
- `BridgeError` — taxonomy with stable `code()` strings used in protocol `Ack.error.code`.

## Invariants

1. **No axum/hyper/tokio::net** in deps. Transport lives in `apps/local-bridge`.
2. **`try_send` only** for `AuditWriter::log`. Bounded channel + drop counter. Caller never blocks.
3. **Transitions via matrix**. `allowed_transition()` list — change = PR review.
4. **Terminal = `Closed`**. No escape.

## Tests

```bash
cargo test -p bridge-core
```

23 tests across event_ring, session_state, resource, audit.

## Related

- [`docs/plans/phase-0.6/02-bridge-core-primitives.md`](../../docs/plans/phase-0.6/02-bridge-core-primitives.md)
- [`docs/plans/phase-1.1/README.md`](../../docs/plans/phase-1.1/README.md) — first real consumer.
