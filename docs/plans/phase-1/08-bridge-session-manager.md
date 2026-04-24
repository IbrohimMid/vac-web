# Plan 08 — Bridge session manager + child spawn

**Phase**: 1 · **Depends on**: Plans 06 (PR #1 merged), 07 · **Blocks**: 09, 10 · **Est**: 2 days

## Goal

Manage the lifecycle of `vac serve --stdio` child processes: spawn per session, pipe stdio, multiplex events back to WS subscribers, clean up on close/timeout/crash.

## Why this is hard

Child process management in async Rust is delicate: stdio pipes can deadlock, signals cross-platform differ, zombie processes appear on panic paths. Plus: per-session writer serialization (for approval races) + broadcast to N subscribers + graceful termination order.

## Scope

### In
- `SessionRegistry` with spawn, lookup, close, enumerate.
- Per-session child process with piped stdin/stdout/stderr.
- Per-session writer mutex (single writer into child stdin).
- Per-session broadcast channel (N subscribers).
- Idle timeout (session pause after 60s with no subscribers).
- Resource limits enforcement.
- Ring buffer for replay.

### Out
- Translator content (Plan 09).
- Profile enforcement (Plan 10).
- Handoff-gated executor spawning (Plan 34 adds that).

## Deliverables

```
apps/local-bridge/src/session/
├── mod.rs
├── registry.rs
├── handle.rs          # SessionHandle: per-session state + ops
├── child.rs           # vac serve child process wrapper
├── stdio.rs           # line-delimited JSON-RPC over stdio
└── lifecycle.rs       # state machine
```

## Stages

### S1 — SessionHandle + state machine (0.3 day)

```rust
pub struct SessionHandle {
    pub id: SessionId,
    pub profile_id: String,
    pub project_root: PathBuf,
    pub state: Arc<RwLock<SessionState>>,
    pub child: Arc<Mutex<ChildProcess>>,
    pub writer: Arc<Mutex<ChildStdin>>,     // single-writer invariant
    pub broadcast: broadcast::Sender<Event>,
    pub ring: Arc<RwLock<EventRing>>,
    pub resource_usage: Arc<ResourceUsage>,
}
pub enum SessionState {
    Spawning, Ready, Active, Idle(Instant), Closing, Closed(ExitReason),
}
```

State transitions documented. Enforced by guard: can't `send_command` when `Closing`.

**Exit**: unit tests for every valid + invalid transition.

### S2 — Child spawn (0.4 day)

```rust
pub async fn spawn(
    profile_id: &str,
    project_root: &Path,
    session_id: SessionId,
) -> Result<ChildProcess> {
    let child = tokio::process::Command::new("vac")
        .arg("serve").arg("--stdio")
        .arg("--profile").arg(profile_id)
        .arg("--project").arg(project_root)
        .arg("--session-id").arg(&session_id.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    ...
}
```

Env scrubbing: drop `ANTHROPIC_API_KEY` etc. from env unless profile explicitly allows. Pass only `PATH`, `HOME`, `VAC_*` vars.

Stderr task: read line-by-line, parse JSON log records, forward to bridge's tracing subscriber.

**Exit**: spawn test — start, verify process alive, send SIGTERM, process exits within 2s.

### S3 — stdio JSON-RPC plumbing (0.4 day)

`stdio.rs`:
- `LinesCodec` wrapping child stdin / stdout.
- Typed encoder: `Command` → line-delimited JSON.
- Typed decoder: line → `Event`.
- On decode error: log structured, skip line (don't kill session).

Writer API:
```rust
pub async fn send_to_engine(&self, cmd: Command) -> Result<()> {
    let mut w = self.writer.lock().await;
    w.write_all(&serde_json::to_vec(&cmd)?).await?;
    w.write_all(b"\n").await?;
    Ok(())
}
```

Reader task: forever read → decode → push to broadcast + ring.

**Exit**: integration test with mock `vac serve` that echoes; command sent, event received.

### S4 — SessionRegistry (0.3 day)

```rust
pub struct SessionRegistry {
    sessions: DashMap<SessionId, Arc<SessionHandle>>,
}
impl SessionRegistry {
    pub async fn create(&self, req: SessionCreatePayload) -> Result<SessionId>;
    pub async fn attach(&self, id: SessionId, client: ClientId) -> broadcast::Receiver<Event>;
    pub async fn detach(&self, id: SessionId, client: ClientId);
    pub async fn close(&self, id: SessionId, reason: CloseReason) -> Result<()>;
    pub async fn list(&self) -> Vec<SessionSummary>;
}
```

Idle detection: background task ticks every 10s; sessions with 0 subscribers for > 60s → mark `Idle`; after 5 min idle → close.

**Exit**: unit test: create 3 sessions, attach/detach clients, idle after 60s detected, closes after 5m (with time mocking).

### S5 — Broadcast + subscriber scaling (0.2 day)

Use `tokio::sync::broadcast::channel(capacity=5000)` per session.
- Lagged subscribers: on `RecvError::Lagged`, send `{type: "replay.out_of_range"}`, close WS with 1008.
- Subscribers never block producer.

Track subscriber count; expose in session summary.

**Exit**: stress test: 10 subscribers, 1k events, slow 1 subscriber, fast ones unaffected.

### S6 — Resource limits (0.2 day)

From `CapabilityProfile.resource_limits`:
- `max_session_wallclock_ms`: background tick checks; if exceeded → `resource.exhausted` event + close.
- `max_tool_calls`: counter incremented per tool-call event; limit → close.
- `max_concurrent_children`: (rare; for assessors spawning sub-agents) — track; reject overflow.

On limit breach: emit event, send SIGTERM to child, after 5s SIGKILL.

**Exit**: unit test simulating limit breach triggers close.

### S7 — Executor session gating (0.2 day)

`create()` for `class = executor` requires `handoff_id`:
```rust
if profile.class == Class::Executor {
    let handoff = handoff_store.get(&req.handoff_id?)?;
    ensure!(handoff.state == HandoffState::Approved);
    ensure!(!handoff.pin.expired());
    ensure!(handoff.pin.verify_worktree()?);
    ensure!(handoff.target.executor_profile_id == req.profile_id);
}
```

(This is early; Plan 32 implements full handoff model. For Phase 1, stub returning "not yet supported" is fine; red-team case RT-038 still exercises the guard.)

**Exit**: `session.create { class: executor }` without handoff rejected.

### S8 — Graceful shutdown (0.2 day)

On bridge SIGTERM:
1. Registry enters drain mode; reject new `session.create`.
2. For each active session: send `session.close` RPC to engine, await ack 5s, then SIGTERM, then SIGKILL.
3. Flush audit logs.
4. Close WS connections with `1001 Going Away`.

**Exit**: integration test: spawn 3 sessions, send SIGTERM to bridge, all children exit within 10s.

## Testing

- Integration tests with mock `vac serve` binary under `tests/fixtures/mock-vac/`.
- Chaos test: kill child externally; registry detects, emits `session.closed { reason: crashed }`.
- Fuzz: malformed JSON from engine stdout; session survives bad lines.

## Exit criteria

- [ ] Spawn + clean teardown verified.
- [ ] Broadcast scaling stress test passes.
- [ ] Idle timeout + resource limits trigger correctly.
- [ ] Executor session gate rejects sans handoff.
- [ ] Graceful bridge shutdown kills all children cleanly.

## Risks

| Risk | Mitigation |
|---|---|
| stdio deadlock (child waiting on full pipe) | Always read stdout/stderr concurrently; never drop reader |
| Zombie processes on panic | `kill_on_drop(true)` + explicit close in Drop |
| Broadcast lagged subscriber unbounded backlog | Send replay.out_of_range, force resync |
| Multi-writer to stdin | Single `Mutex<ChildStdin>`; enforced by type (no clone of writer) |
| SIGTERM ignored by child | Escalate to SIGKILL after 5s; log as anomaly |

## Related

- [`architecture.md`](../../architecture.md) §2, §6 — process model, session lifecycle
- [`capability-profiles.md`](../../capability-profiles.md) §7 — profile pinning
- Plan 07 — WS transport
- Plan 09 — translator (consumer)
- Plan 32 — handoff lifecycle (completes executor gating)
