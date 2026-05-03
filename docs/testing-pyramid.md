# Testing strategy pyramid (slice 42)

Goal: every behavior is covered by the cheapest reliable test, with a
clear escalation path from unit to red-team.

## Layers (bottom = many, fast; top = few, expensive)

1. **Unit tests** — pure functions and capability modules.
   * Locations: `apps/web/src/**/*.test.ts(x)`,
     `apps/local-bridge/src/**/*.rs#[cfg(test)]`,
     `packages/*/src/**/*.test.ts`,
     `packages/*/src/**/*.rs`.
   * Gate: `pnpm --filter @vac-web/web test -- --run`,
     `cargo test -p local-bridge --lib`, `cargo test -p mock-engine`.
2. **Contract / parity tests** — schema vs catalog vs runtime.
   * Examples: codegen drift checks (`scripts/verify-codegen.sh`),
     command-manifest parity (`every_emitted_notification_method_is_catalogued`).
   * Gate: codegen verify in CI; per-slice parity test.
3. **Integration tests** — bridge + mock-engine + a real WebSocket
   client.
   * Locations: `apps/local-bridge/tests/`, `tests/integration/`.
   * Gate: `cargo test -p local-bridge` plus targeted integration jobs.
4. **E2E tests** — full cockpit against mock-engine.
   * Locations: `apps/web/e2e/` (planned), Playwright or similar.
   * Gate: nightly + release.
5. **Red-team tests** — deliberate misuse: profile bypass, malformed
   commands, replay tampering.
   * Locations: `tests/red-team/`, `docs/red-team-test-plan.md`.
   * Gate: weekly + before any auth/profile change.
6. **Performance / load tests** — latency budgets for translator,
   persistence, render path.
   * Locations: `tools/perf/` (planned), tied to `docs/perf-test-plan.md`.
   * Gate: pre-release.
7. **Docs / fitness checks** — boundary lints, ADR coverage, broken
   links, schema docs parity.
   * Locations: `scripts/check-architecture-boundaries.mjs` (planned).
   * Gate: CI on every PR.

## Acceptance bar per slice

Every slice must answer: which layer of this pyramid did you add or
update? If the slice changes runtime behavior and you only updated docs,
the slice is incomplete.

## Per-slice checklist

- [ ] Unit test for every new capability module / pure function.
- [ ] Contract test if you touched a schema, catalog, or generated file.
- [ ] Integration test if you touched translator / session / persistence.
- [ ] Red-team test if you touched profile policy, auth, or audit.
- [ ] Doc check if you touched a public surface (commands, events, ADR
      scope).

## Validation gates (single command source of truth)

```
pnpm --filter @vac-web/web typecheck
pnpm --filter @vac-web/web test -- --run
pnpm --filter @vac-web/web lint
cargo check -p local-bridge
cargo test -p local-bridge --lib
cargo test -p mock-engine
```

These commands must remain green at every commit. CI runs them on every
PR; agents must run them locally before declaring a slice done.
