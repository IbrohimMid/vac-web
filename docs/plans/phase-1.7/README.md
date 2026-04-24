# Phase 1.7 — End-to-End Integration + Red-Team Expansion

**Duration**: 1.5 days
**Position**: after Phase 1.6 (minimal UI); gate to Phase 2
**Status**: ✅ **DONE** (scaffolded; see cargo tests + `apps/web` build)

## Goal

Stress-test the entire Phase 1 stack: real WS client, real bridge, real profile enforcement, mock engine. Run representative scenarios end-to-end without developer intervention. Expand red-team cases to cover the full bridge path (not just `profile-core`). Lock the Phase 1 exit gate.

## Entry criteria

- Phases 1.1–1.6 all exit.
- Workspace tests ≥ 160 passing.
- `pnpm -r build` green.

## Scope

### In
- **Playwright E2E test** driving headless Chromium against real bridge + mock-engine:
  - Pair → session.create → message.submit → stream → message.cancel → session.close.
  - Two-tab sync: open two tabs, submit in A, observe B receives same transcript.
- **Red-team expansion**: cases RT-038..RT-067 at bridge fixture level (session class gating, handoff placeholders, multi-client concurrency, connector-level, prompt-injection).
- **Perf baseline**: first `bench:transcript` + `bench:bundle` numbers captured (Phase 2 optimizes).
- **Sub-phase status update**: all 1.x READMEs marked done.

### Out
- Workbench tabs (Phase 3).
- Real assessment runs (Phase 4).
- Handoff mechanics (Phase 5).

## Day-by-day

### Day 1 — E2E Playwright + perf baseline
- Install Playwright in `apps/web/`.
- Fixture: spawn bridge + mock-engine in beforeAll; tear down in afterAll.
- Tests:
  - Happy path flow.
  - Cancel mid-stream.
  - Reconnect after WS drop.
  - Two-tab sync (open second page with same JWT).
- Capture perf baselines: FPS during streaming, initial bundle size, WS reconnect time. Commit baseline files.

### Day 2 — Red-team full-stack expansion
- Upgrade `tests/red-team/src/harness/` with `BridgeFixture` + `AgentInjector` (axum in-process).
- Migrate existing 10 cases to go through bridge (extend, don't replace).
- Add new cases:
  - RT-038: session.create executor without handoff → bridge deny.
  - RT-051: two clients approve same tool call simultaneously → one wins.
  - RT-053: client with session-scoped JWT attempts other session → deny.
  - RT-057: connector payload with "ignore instructions" → profile denies downstream tool call.
- Total red-team cases at bridge layer: ≥ 30.

## Deliverables

```
apps/web/playwright.config.ts
apps/web/e2e/
├── happy-path.spec.ts
├── cancel.spec.ts
├── reconnect.spec.ts
└── multi-tab-sync.spec.ts

perf/baselines/
├── transcript-fps.json
├── bundle-size.json
└── reconnect-latency.json

tests/red-team/src/harness/
├── bridge_fixture.rs           # consolidated
└── agent_injector.rs
tests/red-team/cases/rt-038..067.rs
```

## Exit criteria (gate to Phase 2)

- [ ] Playwright E2E: all 4 scenarios green.
- [ ] Two-tab sync visually works.
- [ ] Red-team cases RT-001..RT-067 at bridge layer green.
- [ ] Perf baselines committed.
- [ ] Workspace tests ≥ 200 total passing.
- [ ] CI full matrix green (rust + node + schema + red-team + playwright).
- [ ] All sub-phase READMEs (1.1–1.7) status updated to ✅.
- [ ] Root README updated with Phase 1 completion stamp.

## Risks

| Risk | Mitigation |
|---|---|
| Playwright flaky on CI | Retry budget 2; use deterministic mock-engine seeds |
| Perf baselines vary across machines | Only track % change; use `VAC_WEB_PERF_PROFILE=laptop` in CI |
| Red-team migration drops coverage | Checklist: every existing case must appear in new bridge-level form |
| Bridge child-process leak under load | Monitor via `ps` in test teardown; CI detects zombies |

## Related

- [`docs/perf-test-plan.md §3`](../../perf-test-plan.md) — benchmark specs.
- [`docs/red-team-test-plan.md §3`](../../red-team-test-plan.md) — case matrix.
- [Phase 2 plans](../phase-2/) — next sub-phases consume Phase 1 foundations.

## Phase 1 summary

At Phase 1 exit, the stack runs end-to-end: browser + JWT + bridge + profile enforcement + mock engine. Every security boundary has been validated through 60+ red-team cases. Perf baselines captured. UI is ugly but functional.

Phase 2 polishes the cockpit (markdown, virtualization, palette, overlays, notify lanes). Phase 3 adds execution surfaces (approvals, review, sessions, runtime, shell).
