# Phase 8 — Continuous readiness (ongoing)

**Total duration**: ~20 days initial, then ongoing maintenance (5 sub-phases, 1 granular plan in `plans/phase-6-8/`)
**Position**: after Phase 7.7 (remote access green); no phase after — Phase 8 is the steady-state posture
**Status**: 🔴 **NOT STARTED**

## Goal

Flip vac-web from *reactive* (user clicks "Run RTD") to *proactive* (the orchestrator keeps live readiness scores without being asked). The moment a PR merges, CI turns green, or a protected ref gets a push, the relevant assessor families re-run in the background; regressions fire a sticky banner the operator can't miss; a guided-mode wizard walks non-technical founders through just the subset of families their project needs.

Five anchors:

1. **Stage triggers** — `pr.merged`, `branch.pushed` (protected refs), `ci.green`, connector-level health shifts. Each trigger knows which assessor families to re-run (e.g. `pr.merged` → RTD + Security; `ci.green` → Release + Performance).
2. **Continuous mode** — per-project re-eval cadence (cron-style), debounced so a chatty CI doesn't cause RTD-every-minute storms. Intelligent invalidation: re-run a family only when its *input surface* changed (file patterns, connector data, dep lockfile).
3. **Regression detector** — verdict drift from green → red, or a scorecard dropping by > threshold between runs. Distinct from "stuck" (Phase 5 convergence guard, which is handoff-driven) — regression is continuous-mode-driven.
4. **Guided mode** — interactive wizard: project-type picker → release-goal picker → family recommender. Non-technical founders pick "SaaS web app, launching next month" and get RTD + PM + Security + Performance preconfigured; they never see the profile YAML.
5. **`executor.migration@1.0.0`** — the last v1 profile, deferred from Phase 6 for a reason: DB migrations need a distinct trust model (dry-run first, two-party always, reversibility proof). Ships with its own workflow tab, not glued onto Release.

Exit: watching a real project for a week, the continuous dashboard shows verdict history lines per family without a human pressing Run; a synthetic regression (downgrade a dep to force a Security finding) surfaces within one cadence cycle; a guided-mode first-run produces a configured project in < 5 minutes; a migration dry-run fails safe on an intentionally-broken schema change.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **8.1** | Stage triggers (git + CI + connector events → re-run router) | 4 | [39-continuous-readiness](../phase-6-8/39-continuous-readiness.md) §S1 |
| **8.2** | Continuous mode + debounce + input-surface invalidation | 4 | [39-continuous-readiness](../phase-6-8/39-continuous-readiness.md) §S2 |
| **8.3** | Regression detector + sticky-banner escalation | 2 | [39-continuous-readiness](../phase-6-8/39-continuous-readiness.md) §S3 |
| **8.4** | Guided mode wizard + project-type catalog | 3 | [39-continuous-readiness](../phase-6-8/39-continuous-readiness.md) §S4 |
| **8.5** | `executor.migration@1.0.0` + dry-run + reversibility check + migration tab | 5 | [39-continuous-readiness](../phase-6-8/39-continuous-readiness.md) §S5 |
| **8.6** | Red-team cases 146–175 + perf + exit sweep | 2 | — |

## Critical path

```
8.1 ──▶ 8.2 ──▶ 8.3 ──┐
                      ├─▶ 8.4 ──▶ 8.6
8.5 ─────────────────┘
```

- **8.1 first** — without triggers, continuous mode has nothing to react to. Can't be mocked away; real connector webhooks are the primary input.
- **8.2 before 8.3** — the regression detector compares runs produced by continuous mode; it has no runs to compare otherwise.
- **8.4 parallelizable with 8.5** — guided mode is UI + bridge metadata; migration is a new profile + workflow. Different files, different ownership; can run in parallel sessions once 8.1–8.3 anchor the continuous pipeline.
- **8.6 last** — red-team + perf + exit validates the full surface.

### Why 8.5 fans in separately
Migration is a release-time action, not a continuous one. But it consumes the same trust primitives (two-party, pin, audit log) that 8.1–8.3 sharpen, so dropping it here avoids duplicating that work in a dedicated Phase 9.

## Prerequisites

- Phase 7.7 green: hosted dispatch shipped, 145+ red-team cases, 360+ workspace tests.
- Assessor catalog complete (Phase 6.3) — continuous mode re-runs families defined there.
- Gate system (Phase 4.6 + 6.4) — regression detector re-triggers gate transitions.
- Handoff pin semantics (Phase 5.2) — continuous runs honor pin freshness.
- At minimum one CI connector adapter (`github` already + `ci` if separate) operational so `pr.merged` + `ci.green` have real event sources.
- Bridge audit log stable — continuous runs must be discoverable after the fact.

## What's explicitly OUT of Phase 8

- **LLM-driven root-cause analysis** — interpreting *why* a verdict dropped is post-v1.
- **Cross-project meta-dashboard** — vac-web v1 is single-project per bridge.
- **Self-healing auto-dispatch** — regression → auto-handoff is deliberately OFF. Human in the loop on mutation, always.
- **Custom trigger DSL** — continuous mode config is a fixed schema (cadence + family list + input patterns), not a user-scripted rule engine.
- **Migration rollback automation** — reversibility *proof* is required; executing the rollback is still a human-approved dispatch.

## Cross-cutting concerns

### Trigger → family routing
Per `docs/assessment-contract.md §6`, each trigger maps to a family subset:

| Trigger | Fires families |
|---|---|
| `pr.merged` on protected ref | RTD, Security, QA |
| `branch.pushed` to protected ref | RTD, Security |
| `ci.green` on release branch | Release, Performance |
| `ci.red` on release branch | RTD, Reliability |
| `connector.health.degraded` (Sentry) | Reliability, Performance |
| `connector.health.degraded` (Datadog) | Reliability |
| Cadence cron | all configured families |

Routing lives in `orchestrator/stage_triggers.rs`; the table is data, not code, so new connectors can extend it without touching the dispatcher.

### Debounce + invalidation
Naive continuous mode = RTD every hour = API-limits nuclear. Debounce rules (`orchestrator/continuous.rs`):

- **Cadence cron** fires at most 1×/hour per family by default; configurable down to 15min, up to 24h.
- **Event triggers** coalesce within a 60s window — three `pr.merged`s in 90s fire one run.
- **Input-surface invalidation** — each family declares its input pattern (e.g. Security → `package*.json`, `requirements*.txt`, Dockerfile; Frontend → `apps/web/src/**`). If no matching file changed AND no connector event fired since last run, skip the re-run.

Result: quiet projects don't pay the cost of an active continuous mode.

### Regression detector
Compares the latest run of a family to the run it replaced. Regression conditions:

- Verdict dropped (`pass → warn`, `warn → fail`, `pass → fail`).
- Any score category dropped by ≥ 0.15 absolute.
- A previously-resolved finding reappeared (identity_hash match against last green run).

On regression: notify lane `sticky` banner, category `warn` (not `error` — this is informational) with a "Build handoff" CTA that pre-fills the packet with the regressed findings (reuses Phase 5 builder).

### Guided mode UX
Three-step wizard lands in its own overlay stack, not a tab — it's a first-run / first-project flow, not a daily surface:

1. **Project type** — SaaS web app / Mobile app / Library / Data pipeline / Infra tool. Each drives a default family set.
2. **Release goal** — Prototype / Staging / Production / Regulated. Tightens gate thresholds.
3. **Family recommender** — shows the resulting family list with toggle chips; user can deselect.

Output = a `vac.continuous.yaml` written at the project root. No persistent web state — the file is the config SSOT.

### `executor.migration@1.0.0` trust model
Distinct from `executor.code`:

- **Dry-run required** — every migration packet dispatches twice: once against a scratch DB (or `EXPLAIN ANALYZE`-style query plan), once for real. Both runs are pin-verified.
- **Two-party always** — single-signer disabled; `required_signers=2` is a profile-level invariant, not a packet override.
- **Reversibility proof** — the packet must include a tested rollback script. Bridge runs the rollback against the dry-run DB; if it doesn't restore baseline, the whole packet is rejected before real dispatch.
- **Explicit window** — packet declares a maintenance window; dispatch outside the window rejected.

Audit log gets a dedicated subsystem tag (`migration`) so ops can pull a clean timeline.

### Bridge emissions expanded
- `orchestrator.trigger_fired` — records source + families scheduled.
- `orchestrator.run_skipped` — debounce + invalidation decisions surfaced.
- `continuous.cadence_tick` — heartbeat for debugging.
- `regression.detected` — payload carries prev + next verdicts + delta list.
- `migration.dry_run_started` / `migration.dry_run_completed` / `migration.reversibility_verified` / `migration.dispatched`.
- `guided.session_started` / `guided.config_written`.

All additive; no breaking changes.

### Perf budgets (8.6 exit)
- Continuous mode steady-state: < 5% CPU on a 10k-LOC project with 1h cadence, 12 families.
- Trigger → run scheduling latency: ≤ 500ms p95.
- Regression check after a completed run: ≤ 200ms p95 (diff is cheap; compares against last cached run).
- Guided mode first-paint: ≤ 80ms.
- Migration dry-run overhead vs real run: ≤ 1.2× (dry-run shouldn't take dramatically longer).
- Memory: no growth > 80MB/day in steady continuous mode.

### Red-team expansion (cases 146–175)
- Trigger source spoofing — a fake webhook with valid-looking payload rejected without HMAC verification.
- Debounce bypass — sending 1000 rapid triggers in 1s doesn't cause 1000 runs.
- Invalidation skip when the input surface genuinely changed — false negatives as dangerous as false positives.
- Regression detector noise — random-but-green family flapping doesn't fire stick banners.
- Guided-mode config write outside project root — path traversal blocked.
- Migration dry-run write to prod DB — denied (only scratch DB allowed during dry-run phase).
- Migration without reversibility proof — rejected at packet creation.
- Migration dispatch outside maintenance window — rejected.
- Two-party bypass on migration profile — denied (can't override required_signers).
- Connector webhook payload size attack — size limit enforced at bridge boundary.

Target: **≥ 175 red-team cases green by 8.6 exit**.

### Test targets (Phase 8 exit)
- Workspace (Rust): ≥ 440 tests (orchestrator + migration modules heavy).
- Red-team: ≥ 175.
- vitest (web): ≥ 240.
- Playwright E2E: ≥ 8 (existing 6 + continuous regression + guided mode first-run).
- Property-based tests on debounce + invalidation (first use of proptest in the repo).

## Phase 8 exit criteria (steady-state entry)

Phase 8 has no "exit to Phase 9" — it's the steady state. Criteria for declaring ready-for-steady-state:

- [ ] All 8.1–8.5 sub-phases hit their individual exit criteria.
- [ ] Continuous mode dogfood: a real project watched for 7 days produces a populated dashboard with zero manual runs and no false-positive regressions.
- [ ] Synthetic regression test: intentionally downgrade a dep → Security family fires regression banner within one cadence cycle (default 1h, overridden to 5min in test).
- [ ] Guided mode first-run: a project with zero prior vac config produces a `vac.continuous.yaml` in < 5 min and the next cadence tick respects it.
- [ ] Migration dry-run on a prepared DB fixture: a good migration + rollback succeeds; a bad migration (non-reversible) is rejected; two-party enforced.
- [ ] Red-team matrix 1–175 all green.
- [ ] Tests: 440+ workspace / 240+ vitest / 175+ red-team / 8+ Playwright / proptest on debounce.
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green.
- [ ] Root README + `docs/plans/phase-8/README.md` + each sub-phase README marked ✅.

## Rollback plan

Phase 8 is additive and feature-flagged end-to-end. The pre-Phase-8 cockpit still works with everything off.

- **8.1 trigger instability**: disable `continuous.triggers.*`; users keep the manual-run cockpit. No data corruption possible.
- **8.2 debounce tuning wrong**: two failure modes — too chatty (flood) or too quiet (miss real regressions). Ship with conservative defaults; expose via `vac.continuous.yaml` for per-project tuning.
- **8.3 regression detector noise**: observe-only mode for first week (log `regression.detected` but don't fire sticky banner); turn on banners after tuning.
- **8.4 guided-mode UX too clunky**: keep the manual Readiness Hub as primary; guided mode is an opt-in entry point, not a forced first-run.
- **8.5 migration profile bugs**: migration is gated behind an explicit CLI opt-in (`vac migration enable`); never on by default. If dry-run is unreliable, fail closed — don't allow real dispatch until fixed.
- **8.6 red-team regressions**: blocker. No hotfix without a green matrix.

If continuous mode's perf budget blows past 5% CPU: introduce per-family adaptive backoff (family that returned `pass` twice in a row stretches its cadence by 1.5×, up to a ceiling).

## Execution policy

- 8.1 first, solo — the trigger router is the foundation; no parallel work on 8.2 until it freezes.
- 8.4 and 8.5 parallelize once 8.1–8.3 land.
- After each sub-phase: `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm --filter @vac-web/web typecheck && test && build`. Red blocks progression.
- Red-team cases land *with* the sub-phase that introduces them, not deferred to 8.6.
- Audit cycle after 8.6, matching the Phase 1–7 pattern, with an extra operations-lens review (Phase 8 creates 24/7 background work; ops readiness is first-class).
- Continuous dogfood on the vac-web repo itself starts the day 8.3 lands; bugs found on our own project count for exit criteria.

## Related

- [`docs/roadmap.md §Phase 8`](../../roadmap.md)
- [`docs/assessment-contract.md`](../../assessment-contract.md) — §6 trigger-to-family routing SSOT.
- [`docs/capability-profiles.md`](../../capability-profiles.md) — §4.2 `executor.migration@1.0.0` trust model.
- [`docs/gates.md`](../../gates.md) — gate transitions driven by regression events.
- [`docs/handoff-contract.md`](../../handoff-contract.md) — migration packet shape + dry-run wrapper.
- [`docs/connectors.md`](../../connectors.md) — webhook adapters + HMAC expectations.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — cases 146–175.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs for 8.6.
- Parent plan: [`phase-6-8/39-continuous-readiness.md`](../phase-6-8/39-continuous-readiness.md).
