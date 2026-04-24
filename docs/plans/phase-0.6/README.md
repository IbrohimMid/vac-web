# Phase 0.6 — Integration Readiness

**Duration**: 3–5 days
**Position**: after Phase 0.5 (harness + contracts locked); before Phase 1.1 (bridge WS server)
**Status**: ✅ **DONE** — `tools/mock-engine/` + `packages/bridge-core/` + `tests/integration/` shipped; 22 bridge-core tests + 6 integration roundtrip tests green; TS build verified via `pnpm install`.

## Why this sub-phase exists

Phase 0.1–0.5 produced contract artefacts + profile enforcement primitives. Phase 1 will build the axum WebSocket server, spawn real `vac serve` children, and stream events to a web UI. But **between the two, we need to prove the plumbing works end-to-end without committing to the real engine yet.**

Without 0.6:
- Phase 1 Plan 07 (axum WS) has no target to talk to; integration tests are hand-mocked.
- Bridge primitives (`AuditWriter`, `EventRing`, `ResourceUsage`) are invented per-plan; drift likely.
- TypeScript side never built; `protocol-ts` + `ajv` integration unverified.
- Red-team cases can't cross the bridge layer until a mock engine exists.

Phase 0.6 produces the **integration substrate** that makes Phase 1 plans composable.

## Entry criteria

- Phase 0.5 green: 48 workspace tests + 10 red-team tests passing.
- `cargo clippy --workspace -- -D warnings` clean.
- `pnpm install` accessible (requires network once; artefacts cached thereafter).

## Scope

### In
- **Mock engine binary** (`mock-engine`): stdio JSON-RPC stub conforming to `vac serve --stdio` contract.
- **Bridge-core crate** (`packages/bridge-core/`): transport-agnostic primitives — `AuditWriter`, `EventRing`, `ResourceUsage`, `SessionState` enum, error types.
- **TypeScript build verification**: `pnpm install` + `pnpm -r build` green; web can import from `@vac-web/protocol`.
- **AJV schema validation**: `scripts/schema-validate.sh` runs end-to-end; first 8 sample fixtures pass.
- **End-to-end roundtrip test**: spawn mock-engine → send envelope → receive stream → verify. Proves the stack works before real bridge land.

### Out
- Real axum WebSocket server (Phase 1.1).
- Real `vac serve` (upstream VAC PR #1; Phase 0.5 S12).
- Session management details (Phase 1.2).
- Profile enforcement wiring (Phase 1.3).

## Granular plans (task view)

- [01 — Mock engine binary](./01-mock-engine.md)
- [02 — Bridge-core primitives](./02-bridge-core-primitives.md)
- [03 — TypeScript build + AJV verification](./03-ts-build-ajv.md)
- [04 — End-to-end roundtrip integration test](./04-integration-roundtrip.md)

## Day-by-day (iteration view)

### Day 1 — Mock engine foundation
- Create `tools/mock-engine/` crate.
- Implement minimal JSON-RPC over stdio: accepts `handshake` → replies `welcome`; accepts `message.submit` → emits 5-delta transcript stream.
- Hardcoded scripted behaviour for deterministic tests.

### Day 2 — Bridge-core primitives
- Create `packages/bridge-core/` crate.
- `AuditWriter` (non-blocking JSONL writer via channel).
- `EventRing` (bounded ring for replay).
- `ResourceUsage` (counters + limits).
- `SessionState` enum + legal transition matrix.
- 20+ unit tests.

### Day 3 — TypeScript verification
- Run `pnpm install` (captures lockfile).
- Fix any TS compile issues in generated types.
- Wire `@vac-web/protocol` consumer test in `apps/web/`.
- `pnpm -r build` green.

### Day 4 — AJV + schema-validate
- Install AJV formats + ajv-cli at workspace root.
- Adjust `schema-validate.sh` to load `_defs/primitives.schema.json` as refs.
- Confirm all 27 samples pass / invalid samples fail.

### Day 5 — Integration test
- Harness: spawn mock-engine via `tokio::process::Command`, pipe stdio.
- Drive scripted scenarios: handshake → message.submit → receive 5 deltas → session.close.
- Test in `tests/integration/` workspace target.
- Demonstrates pipeline foundations work.

## Deliverables

```
tools/mock-engine/                       # new crate
├── Cargo.toml
├── src/main.rs                          # JSON-RPC stdio loop
├── src/scenarios.rs                     # scripted responses
└── README.md

packages/bridge-core/                    # new crate
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── audit.rs                         # AuditWriter + channel
│   ├── event_ring.rs                    # bounded replay buffer
│   ├── resource.rs                      # counters + limits
│   ├── session_state.rs                 # state machine enum
│   └── error.rs                         # BridgeError
├── tests/
│   ├── audit.rs
│   ├── event_ring.rs
│   └── session_state.rs
└── README.md

tests/integration/                       # new test crate
├── Cargo.toml
├── tests/roundtrip.rs                   # mock-engine spawn + stdio exchange
└── src/lib.rs                           # shared test helpers

pnpm-lock.yaml                           # committed after `pnpm install`
apps/web/src/protocol-consumer.test.ts   # smoke test
```

## Exit criteria (gate to Phase 1.1)

- [ ] `mock-engine` binary spawns + exchanges messages deterministically.
- [ ] `bridge-core` unit tests all green (target: 20+ tests).
- [ ] `pnpm install` + `pnpm -r build` + `pnpm -r test` green.
- [ ] `scripts/schema-validate.sh` validates all samples.
- [ ] Integration test: bridge-core + mock-engine roundtrip passes.
- [ ] Total workspace tests ≥ 75.
- [ ] No new clippy/fmt warnings.

## Risks

| Risk | Mitigation |
|---|---|
| Mock-engine divergence from real `vac serve` (PR #1) | Both implement same JSON-RPC subset documented in `docs/protocol.md` §3; CI comparison once PR #1 merges |
| Bridge-core API premature lock-in | Start with minimal surface; extend per Phase 1 plan demand |
| `pnpm install` breaks in CI (lockfile / registry) | Use `pnpm install --frozen-lockfile`; commit lockfile |
| AJV `$ref` resolution across files fragile | Load `_defs/primitives.schema.json` as explicit ref; verify with deliberate invalid fixture |
| Integration test flaky (child process timing) | Timeout + retry budget; use `tokio::time::timeout` on every await |

## Why separate crate `bridge-core`?

Three reasons:
1. **Testability** — no axum/tokio network = fast unit tests (~ms).
2. **Reusability** — same primitives used by red-team harness in Phase 1.3 onwards.
3. **Clean ownership** — Phase 1.1's `local-bridge` depends on `bridge-core`; if design drifts, layering shows it.

Alternative considered: put primitives directly in `local-bridge`. Rejected because it couples unit-testable logic to HTTP server lifecycle.

## Related

- [`docs/plans/phase-1/07-bridge-axum-ws.md`](../phase-1/07-bridge-axum-ws.md) — consumer of bridge-core.
- [`docs/plans/phase-1/08-bridge-session-manager.md`](../phase-1/08-bridge-session-manager.md) — uses AuditWriter, EventRing.
- [`docs/protocol.md`](../../protocol.md) §3 — JSON-RPC command catalog mock-engine implements.
- [`docs/plans/phase-0.5/06-upstream-vac-prs.md`](../phase-0.5/06-upstream-vac-prs.md) — PR #1 is the "real" counterpart to mock-engine.

## Handoff to Phase 1.1

Phase 1.1 (axum WS server) assumes:
- `bridge-core::AuditWriter` usable as session audit log writer.
- `bridge-core::EventRing` usable for per-session replay buffer.
- `mock-engine` binary spawned by integration tests until PR #1 lands.

Ship Phase 0.6 with all tests green → Phase 1.1 starts with zero new primitives to invent.
