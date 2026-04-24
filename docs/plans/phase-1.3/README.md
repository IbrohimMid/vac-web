# Phase 1.3 — Translator + Profile Enforcement (Layer 1)

**Duration**: 3 days
**Position**: after Phase 1.2 (session manager); before Phase 1.4 (pairing + audit)
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Combine two of the most load-bearing pieces:
1. **Translator** — wire protocol v1 envelopes ↔ JSON-RPC to child engine. Handles correlation, coalescing, bridge-local events (overlay stack, system pulse).
2. **Layer 1 enforcement** — every crossing checked against pinned `CapabilityProfile` via `profile-core`. Red-team cases RT-001..RT-037 must pass at bridge layer from this phase.

Combining them into one sub-phase because the translator is where enforcement lives; separating them creates drift.

## Entry criteria

- Phase 1.2 exit: session manager spawns + tears down cleanly; 95+ tests passing.
- `profile-core` API stable + ready for integration.

## Scope

### In
- Command → JSON-RPC mapping per `docs/plans/phase-1/09-bridge-translator.md`.
- JSON-RPC notification → event (reverse).
- Command correlation (id ↔ ack).
- Transcript delta coalescing (≤ 60 events/s/session).
- Bridge-local events: `session.ready`, `overlay.opened/dismissed`, `system_pulse.updated`.
- OverlayManager state (stack per session, multi-client sync).
- Layer 1 enforcement via `profile-core::enforce_*` at every tool call + action invocation.
- Hash handshake: bridge advertises profile hash; engine verifies.
- Red-team cases RT-001..RT-037 all passing at bridge layer (extend harness).

### Out
- Engine-side Layer 2 enforcement (upstream VAC PR #4).
- Pairing / JWT (Phase 1.4).
- Handoff dispatch (Phase 5).

## Granular plans

Combines:
- [`docs/plans/phase-1/09-bridge-translator.md`](../phase-1/09-bridge-translator.md)
- [`docs/plans/phase-1/10-bridge-profile-enforcement.md`](../phase-1/10-bridge-profile-enforcement.md)

## Day-by-day

### Day 1 — Command/event mapping + correlation
- `translator/cmd_to_rpc.rs`: per-type conversion.
- `translator/rpc_to_event.rs`: inverse.
- `correlation.rs`: pending HashMap with 30s timeout.
- Normalize engine errors to protocol v1 error envelope.

### Day 2 — Coalescing + bridge-local events
- Transcript delta coalescing (per-message buffer, 16ms flush tick, max 60 events/s).
- OverlayManager: push/pop/dismiss_all with depth cap 2.
- SystemPulse aggregator: facets from session state + engine metrics.
- Multi-client overlay sync via broadcast.

### Day 3 — Profile enforcement + red-team expansion
- Wire `profile-core::enforce_tool` at bridge router entry.
- Shell allowlist check on `shell.exec_allowlisted` envelope.
- fs read/write + network enforcement at tool-call inspect.
- Hash handshake: bridge sends `profile.handshake { id, hash }` as first RPC; engine acks.
- Extend `tests/red-team/` to drive through bridge (not just `profile-core` directly).
- Cases RT-001 to RT-037 all green.

## Deliverables

```
apps/local-bridge/src/
├── translator/
│   ├── mod.rs
│   ├── cmd_to_rpc.rs
│   ├── rpc_to_event.rs
│   ├── coalesce.rs
│   ├── correlation.rs
│   └── injected.rs
├── profile_layer.rs          # enforcement entry point
├── overlay_state.rs
└── system_pulse.rs
tests/red-team/src/harness/
├── bridge_fixture.rs         # NEW: in-process axum + mock-engine
├── agent_injector.rs         # NEW: crafted WS envelope sender
└── assertions.rs             # NEW: layer-aware denial assertions
tests/red-team/cases/         # 30+ case files (one per RT-xxx)
```

## Exit criteria (gate to Phase 1.4)

- [ ] Every v1 command type dispatches correctly (pass-through, bridge-local, or split).
- [ ] Coalescing: 1000 deltas in 1s → ≤ 60 output events.
- [ ] OverlayManager: two-tab test shows sync.
- [ ] Correlation: 50 in-flight commands → all acked.
- [ ] Hash handshake mismatch → session aborts with clear error code.
- [ ] Red-team RT-001..RT-037 all green through bridge fixture.
- [ ] Zero unsafe tool escapes to engine (verified via audit log inspection).
- [ ] Workspace ≥ 140 tests (adds ~40).

## Risks

| Risk | Mitigation |
|---|---|
| Coalescing loses ordering | Per-message FIFO; seq monotonic across messages |
| Silent drop of unknown engine event | Warn + notify.event; never drop silently |
| Enforcement bypass via new code path | Single entry point `profile_layer::enforce()`; lint ensures call site |
| Pattern compile cost | Lazy-compile cache per (profile_id, pattern) |

## Related

- [Plan 09 — translator](../phase-1/09-bridge-translator.md)
- [Plan 10 — enforcement](../phase-1/10-bridge-profile-enforcement.md)
- [`packages/profile-core/README.md`](../../../packages/profile-core/README.md)
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) §3

## Handoff to Phase 1.4

Phase 1.4 adds authentication + audit logging on top of this translator. The enforcement `Decision` variants emitted here become audit entries then.
