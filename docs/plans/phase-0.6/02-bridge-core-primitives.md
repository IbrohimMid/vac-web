# Plan 0.6-02 — Bridge-core primitives

**Phase**: 0.6 · **Depends on**: Phase 0.5 · **Blocks**: 1.1–1.4 · **Est**: 1.5 days

## Goal

Create `packages/bridge-core/` — a transport-agnostic crate housing the stateful primitives (AuditWriter, EventRing, ResourceUsage, SessionState) that Phase 1 axum server + session manager depend on. Extracting them early prevents drift + allows unit testing without HTTP/WS lifecycle.

## Why this is hard

These primitives look "obvious" but have subtle correctness requirements:
- **AuditWriter**: non-blocking (drops vs backpressures?), crash-safe (fsync vs not?), size-rotated.
- **EventRing**: bounded but must never drop events from the middle; replay must handle "last_event_id older than ring's oldest" with dedicated error.
- **ResourceUsage**: atomic counters AND session-wide budget enforcement — has to work under concurrent tool calls.
- **SessionState**: state machine transitions; a bad transition can leak processes.

Getting them right once here means every Phase 1 consumer gets them for free.

## Scope

### In
- `AuditWriter` — buffered, non-blocking JSONL append-only; size-rotated.
- `EventRing<T>` — bounded ring with replay-after-cursor + out-of-range detection.
- `ResourceUsage` — atomic counters tracking tool-calls, wallclock, child-count.
- `SessionState` — enum + transition matrix.
- `BridgeError` — taxonomy of errors with stable codes.
- Unit tests ≥ 20 across these.

### Out
- Full session manager (Phase 1.2; consumes these).
- Axum handlers (Phase 1.1; consumes these).
- Profile enforcement (already in `profile-core`).

## Deliverables

```
packages/bridge-core/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── audit.rs
│   ├── event_ring.rs
│   ├── resource.rs
│   ├── session_state.rs
│   └── error.rs
├── tests/
│   ├── audit.rs
│   ├── event_ring.rs
│   ├── resource.rs
│   └── session_state.rs
└── README.md
```

## Stages

### S1 — Scaffold + error taxonomy (0.2 day)

```rust
// error.rs
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("session state illegal: {from:?} → {to:?}")]
    InvalidTransition { from: SessionState, to: SessionState },
    #[error("replay out of range: requested {requested}, oldest {oldest}")]
    ReplayOutOfRange { requested: u64, oldest: u64 },
    #[error("resource exhausted: {what}")]
    ResourceExhausted { what: &'static str },
    #[error("audit write failed: {0}")]
    Audit(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("internal: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, BridgeError>;
```

Every error carries a stable code used in protocol `Ack.error.code`.

**Exit**: builds + trivial unit test constructs each variant.

### S2 — AuditWriter (0.4 day)

```rust
pub struct AuditWriter {
    tx: mpsc::Sender<AuditEntry>,
}
pub struct AuditEntry {
    pub ts: DateTime<Utc>,
    pub session_id: String,
    pub subsystem: String,
    pub severity: AuditSeverity,
    pub fields: serde_json::Value,
}
pub enum AuditSeverity { Info, Warn, Error }

impl AuditWriter {
    pub fn spawn(dir: PathBuf, config: AuditConfig) -> Self {
        let (tx, rx) = mpsc::channel(8192);
        tokio::spawn(writer_task(rx, dir, config));
        Self { tx }
    }
    pub fn log(&self, entry: AuditEntry) {
        let _ = self.tx.try_send(entry);  // drop-on-overflow with metric
    }
}
```

Writer task:
- Buffered by 100 entries OR 100ms tick, whichever first.
- Append to `<dir>/<session_id>.jsonl`.
- Rotate at `config.rotate_bytes` (default 10MB); `gz` old file.
- fsync every N writes (configurable).
- On IO error: log warn to `tracing`, drop entry, increment `audit.write_failure` counter.

Tests:
- Write 1000 entries across 3 sessions → 3 files present with expected counts.
- Flood test (100k entries in 1s) → process doesn't OOM; `try_send` drops kick in.
- Rotation test (small `rotate_bytes`) → multiple `.1.gz`, `.2.gz` files.

**Exit**: 6+ tests green.

### S3 — EventRing (0.3 day)

```rust
pub struct EventRing<T: Clone> {
    buf: VecDeque<(u64, T)>,
    cap: usize,
    next_seq: u64,
}

impl<T: Clone> EventRing<T> {
    pub fn new(cap: usize) -> Self { ... }
    pub fn push(&mut self, ev: T) -> u64 { ... }    // returns assigned seq
    pub fn replay_after(&self, last_event_id: u64) -> ReplayResult<T> { ... }
    pub fn oldest_seq(&self) -> Option<u64> { ... }
    pub fn latest_seq(&self) -> Option<u64> { ... }
}

pub enum ReplayResult<T> {
    Stream(Vec<(u64, T)>),
    OutOfRange { oldest: u64, requested: u64 },
    UpToDate,
}
```

Invariants:
- `seq` monotonically increasing across all `push`.
- Ring drops oldest on overflow; tracked via `oldest_seq()`.
- `replay_after(last)` returns events with `seq > last`.
- If `last < oldest_seq()`: return `OutOfRange`.
- If `last >= latest_seq()`: return `UpToDate`.

Tests:
- Push 100 → replay after 50 returns 50 events.
- Cap=10, push 15 → oldest=6; replay after 3 returns OutOfRange.
- Push 0 → latest_seq None, oldest None, replay returns UpToDate.
- Concurrent push via Mutex wrapper (doc test).

**Exit**: 5+ tests green.

### S4 — ResourceUsage (0.2 day)

```rust
pub struct ResourceUsage {
    tool_calls: AtomicU64,
    started_at: Instant,
    children: AtomicU32,
    limits: ResourceLimits,
}
pub struct ResourceLimits {
    pub max_tool_calls: Option<u64>,
    pub max_wallclock: Option<Duration>,
    pub max_concurrent_children: Option<u32>,
}

impl ResourceUsage {
    pub fn new(limits: ResourceLimits) -> Self { ... }
    pub fn increment_tool_calls(&self) -> Result<()> { ... }  // returns Err on overflow
    pub fn acquire_child(&self) -> Result<ChildGuard> { ... }  // RAII for decrement
    pub fn check_wallclock(&self) -> Result<()> { ... }
    pub fn snapshot(&self) -> ResourceSnapshot { ... }
}
```

`ChildGuard` impl `Drop` decrements counter. Prevents leaks even on panic.

Tests:
- 10 increments with limit 10 → 11th returns Err.
- Acquire 5 children with limit 5; drop all → usage 0.
- Wallclock test with `--test-time` hook (inject time).

**Exit**: 4+ tests green.

### S5 — SessionState + transition matrix (0.2 day)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Spawning, Ready, Active, Idle, Closing, Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason { Graceful, Crashed, Timeout, ResourceExhausted, Cancelled }

pub fn allowed_transition(from: SessionState, to: SessionState) -> bool {
    use SessionState::*;
    matches!(
        (from, to),
        (Spawning, Ready) | (Spawning, Closed) |
        (Ready, Active) | (Ready, Closing) |
        (Active, Idle) | (Active, Closing) |
        (Idle, Active) | (Idle, Closing) |
        (Closing, Closed)
    )
}
```

State holder:
```rust
pub struct StateHolder {
    state: RwLock<SessionState>,
    close_reason: RwLock<Option<CloseReason>>,
}
impl StateHolder {
    pub fn transition(&self, to: SessionState) -> Result<SessionState> {
        let mut g = self.state.write().unwrap();
        if !allowed_transition(*g, to) {
            return Err(BridgeError::InvalidTransition { from: *g, to });
        }
        let prev = *g; *g = to; Ok(prev)
    }
}
```

Tests:
- Every legal edge: pass.
- Every illegal edge: Err.
- Concurrent transitions: only one wins (test with Arc).
- Terminal states (Closed): no transition out.

**Exit**: 6+ tests green (every allowed transition + representative illegals).

### S6 — lib.rs public API (0.1 day)

```rust
//! Transport-agnostic primitives for local-bridge. Consumed by apps/local-bridge
//! and tests/integration. No axum, no tokio::net, no WebSocket.

pub mod audit;
pub mod event_ring;
pub mod resource;
pub mod session_state;
pub mod error;

pub use audit::{AuditEntry, AuditSeverity, AuditWriter, AuditConfig};
pub use event_ring::{EventRing, ReplayResult};
pub use resource::{ResourceLimits, ResourceUsage, ChildGuard};
pub use session_state::{SessionState, CloseReason, StateHolder, allowed_transition};
pub use error::{BridgeError, Result};
```

**Exit**: `use bridge_core::*;` from a consumer compiles; common types reachable.

### S7 — README (0.1 day)

Document the three invariants:
1. No transport code.
2. No async lock held across `.await` (`RwLock<T>` from `std::sync`, not `tokio::sync`, where feasible).
3. Every error has a stable code usable in protocol `Ack.error.code`.

List consumer crates + example.

**Exit**: reviewer can use bridge-core without reading source.

## Exit criteria

- [ ] `cargo build -p bridge-core` green.
- [ ] `cargo test -p bridge-core` ≥ 20 tests passing.
- [ ] Every error code documented in README.
- [ ] No `axum`/`hyper`/`tokio::net` in deps (only `tokio` for runtime + I/O).

## Risks

| Risk | Mitigation |
|---|---|
| AuditWriter backpressure lost | Metric counter on drop; tracked explicitly |
| EventRing seq overflow (u64) | Document: at 1M ev/s, overflow after 500k years |
| ResourceUsage race | Use AtomicU64 + Ordering::Relaxed where load-store is enough; AcqRel for guard |
| SessionState matrix incomplete | Enum exhaustive match; clippy catches missing arms |

## Related

- [`docs/plans/phase-1/07-bridge-axum-ws.md`](../phase-1/07-bridge-axum-ws.md) — consumer.
- [`docs/plans/phase-1/08-bridge-session-manager.md`](../phase-1/08-bridge-session-manager.md) — consumer.
- [`docs/plans/phase-1/11-bridge-pairing-audit.md`](../phase-1/11-bridge-pairing-audit.md) — AuditWriter consumer.
- [`docs/capability-profiles.md`](../../capability-profiles.md) §10 — audit schema.
