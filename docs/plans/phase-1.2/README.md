# Phase 1.2 — Session Manager + Child Spawn

**Duration**: 2–3 days
**Position**: after Phase 1.1 (WS transport); before Phase 1.3 (translator + enforcement)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Manage the lifecycle of child processes that fulfill sessions: spawn via stdio (initially `mock-engine`; later `vac serve`), multiplex events back to subscribers, idle-timeout stale sessions, enforce resource budgets, handle crashes cleanly. Turn "bridge serves one pretend session" into "bridge serves N real sessions."

## Entry criteria

- Phase 1.1 exit: axum WS server green; single subscriber works; replay via EventRing verified.
- `bridge-core::SessionState` transitions + `ResourceUsage` tested.
- `mock-engine` spawnable via `MockEngineHandle`.

## Scope

### In
- `SessionRegistry` (DashMap keyed by SessionId).
- `SessionHandle` per session: child process + stdio pipes + broadcast + ring.
- Spawn `mock-engine --stdio --profile <id>` (swap to `vac serve` when PR #1 lands).
- Writer mutex (single-writer into child stdin).
- `broadcast::channel` per session; N subscribers safely.
- Idle detection: 0 subscribers for 60s → mark Idle; 5min idle → close.
- Graceful shutdown: SIGTERM → SIGKILL after 5s.
- Executor-session gating stub: reject `class=executor` without `handoff_id`.
- Env scrubbing: drop secrets from child env.

### Out
- Translator (Phase 1.3 — wraps this).
- Profile enforcement Layer 1 (Phase 1.3).
- Real handoff verification (Phase 5 — stub here).

## Granular plan

Follows [`docs/plans/phase-1/08-bridge-session-manager.md`](../phase-1/08-bridge-session-manager.md).

## Day-by-day

### Day 1 — SessionHandle + SessionState machine
- `SessionHandle` struct with child handle, stdin writer (Mutex), broadcast sender, EventRing.
- State transitions through `bridge-core::StateHolder`.
- Spawn + teardown test (mock-engine).

### Day 2 — Registry + multi-session
- `SessionRegistry::create/attach/detach/close/list`.
- Broadcast: N subscribers; lagged → `replay.out_of_range`.
- Stress: 10 concurrent sessions, 5 subscribers each.

### Day 3 — Idle timeout + resource limits + handoff gate
- Idle detection task (ticks every 10s).
- `ResourceUsage::check_wallclock` integrated with session close.
- `session.create { class: executor }` without handoffId rejected with specific error code.
- Integration test: full lifecycle spawn → idle → close → re-create.

## Deliverables

```
apps/local-bridge/src/session/
├── mod.rs
├── registry.rs
├── handle.rs
├── child.rs
├── stdio.rs
└── lifecycle.rs
tests/integration/tests/session_manager.rs
```

## Exit criteria (gate to Phase 1.3)

- [ ] Spawn 10 sessions concurrently; each survives.
- [ ] Idle timeout: session with 0 subscribers → Idle after 60s; closed after 5min.
- [ ] Executor session without handoffId → rejected.
- [ ] SIGTERM to bridge kills all children within 10s.
- [ ] Resource limit breach (wallclock) → session closed with specific event.
- [ ] 20+ integration tests; workspace ≥ 95 passing total.

## Risks

| Risk | Mitigation |
|---|---|
| stdio deadlock (child waits on full pipe) | Always pump stdout + stderr concurrently |
| Zombie on panic | `kill_on_drop(true)` + explicit Drop + panic catch in spawn task |
| Broadcast lagged subscriber | `replay.out_of_range` event + force resync |
| Multi-writer to stdin | Type-enforced via `Arc<Mutex<ChildStdin>>` (no Clone) |

## Related

- [Plan 08 — session manager](../phase-1/08-bridge-session-manager.md)
- [`bridge-core/src/session_state.rs`](../../../packages/bridge-core/src/session_state.rs)
- [`docs/architecture.md §6`](../../architecture.md) — session lifecycle

## Handoff to Phase 1.3

Phase 1.3 wraps translator around `SessionRegistry`:
- Envelope-to-RPC dispatch routes through registry.
- Engine events broadcast via session handle.
- Profile enforcement intercepts between WS handler + translator.
