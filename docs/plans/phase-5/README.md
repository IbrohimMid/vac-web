# Phase 5 — Handoff + Reassess loop

**Total duration**: ~9 days (6 sub-phases, 4 granular plans)
**Position**: after Phase 4.8 (Assessment MVP green); before Phase 6 (remaining assessors + Release plane)
**Status**: 🔴 **NOT STARTED**

## Goal

Close the build → assess → handoff → execute → **reassess** → release loop. At Phase 4 we can detect problems; at Phase 5 we can **hand work to an executor under constraint**, re-run assessment against the fresh state, and show the operator whether the fixes actually moved the verdict.

Four anchors:

1. **Handoff packet lifecycle with pin** — worktree digest + base SHA + connector snapshot bindings frozen into each packet so the executor cannot act against drifted state silently. Pin verification rejects a dispatch whose inputs moved.
2. **Two-party approval** — authoring a packet and approving it are separable acts; both are audit-logged with role + reason. ReadyToDeploy depends on this mechanism in Phase 4 but the *handoff* surface is where two-party first becomes load-bearing.
3. **Dispatch + executor binding** — an approved packet spawns an executor session against the pinned state with a narrow profile (`executor.code@1.0.0`), streams progress as a first-class surface, and auto-triggers reassess on completion.
4. **AssessmentDiff + convergence guard** — compute four-way diff (resolved / persistent / regressed / new) using the same identity hash from Phase 4.3; a counter tracks "stuck" reassess cycles and escalates after 3× no-improvement.

Exit: RTD finding → build packet → approve (two-party) → dispatch → executor fixes → reassess → verdict moves from `fail`→`pass` **and** the diff view shows every RTD finding as `resolved`. Pin drift mid-approval rejects with `handoff.invalidated`. Convergence guard fires on a 3× stuck chain.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **5.1** | Upstream VAC PR #8 (`worktree_digest` util + pin verify + `executor.code@1.0.0` profile) | 2 | [32-handoff-lifecycle-pin](./32-handoff-lifecycle-pin.md) §upstream |
| **5.2** | Handoff packet lifecycle + pin capture/verify (bridge) | 2 | [32-handoff-lifecycle-pin](./32-handoff-lifecycle-pin.md) |
| **5.3** | HandoffBuilder UI + two-party approval + invalidation banner | 2 | [33-handoff-builder-ui](./33-handoff-builder-ui.md) |
| **5.4** | Dispatch + executor session binding + live execution view | 2 | [34-handoff-dispatch](./34-handoff-dispatch.md) |
| **5.5** | AssessmentDiff compute + 4-tab viewer + convergence guard | 1.5 | [35-assessment-diff](./35-assessment-diff.md) |
| **5.6** | Cross-profile chain test + red-team + exit sweep | 0.5 | — |

## Critical path

```
5.1 ──▶ 5.2 ──▶ 5.3 ──▶ 5.4 ──▶ 5.5 ──▶ 5.6
```

Strictly linear. Parallelization is tempting but risky:

- **5.1 gates everything** — pin verify semantics live in upstream. Without a frozen `worktree_digest` algorithm, bridge pin compute will drift from what the executor verifies.
- **5.2 before 5.3** — UI needs a stable packet envelope to author against. Shipping UI against a mock packet shape that changes would waste a full sub-phase.
- **5.3 before 5.4** — dispatch is only meaningful against an *approved* packet; the approval flow must exist first.
- **5.4 before 5.5** — diff compute triggers on a *second* assessment run, which only happens post-dispatch/execute/reassess.
- **5.5 before 5.6** — exit sweep validates the full loop; can't demo it without diff working.

## Prerequisites

- Phase 4.8 green: Readiness Hub, Gate system, full assessment pipeline, 60+ vitest / 180+ workspace tests.
- `identity_hash` behaviour stable on both emit + diff sides (Phase 4 shipped the emit side; 5.5 consumes).
- `assessor.rtd@1.0.0` + `assessor.pm@1.0.0` profiles operational.
- Bridge ready-to-extend: `apps/local-bridge/src/handoff/` scaffold usable (stubs may exist from Phase 0 — verify before 5.2 starts).
- Connectors usable for snapshot binding: minimum `github` (base SHA + branch); `notion` / `linear` optional.
- xterm / transcript plumbing (Phase 3.4 + 2.1) — live execution view reuses it.

## What's explicitly OUT of Phase 5

- **Remaining assessor families** (UX/SEC/OPS/Perf/QA/Launch/Release) — Phase 6.
- **Release plane + Blueprints UX** — Phase 6.
- **Hosted dispatch (web-CLI)** — Phase 7.
- **Continuous readiness scheduler** — Phase 8.
- **Multi-executor parallel dispatch** — post-v1; v1 serializes per packet.
- **Cross-repo handoff** — post-v1; pin is scoped to a single worktree.

## Cross-cutting concerns

### Pin semantics (foundational)
Per `docs/handoff-contract.md §4`, a pin records:
- `worktree_digest` — a deterministic hash of tracked-file contents at assessment-time.
- `base_sha` — Git HEAD at that moment.
- `connector_snapshots` — per-connector freeze-frames (e.g. GitHub issue list at time T, Notion page revs).
- `captured_at` — timestamp.
- `policy` — `strict` (any drift invalidates) or `lenient` (only digest changes invalidate).

Dispatch re-verifies pin before spawning the executor session; `handoff.invalidated` fires on mismatch. Strict is the default for Phase 5.

### Two-party approval (now load-bearing here)
Authoring ≠ approving. Two distinct command types hit the bridge with distinct audit records:
- `handoff.create` — any signer.
- `handoff.approve` — requires a *different* signer name (identity from session auth).
Bridge rejects second-signer = first-signer with `handoff.conflict_self_sign`. Signoff thresholds per packet configurable (default 2 for `executor.code`; 1 for low-risk tasks).

### Convergence guard
Per `docs/assessment-contract.md §5`. After handoff completes and reassess runs, the bridge computes `diff(prev_run, new_run)` per category. If for 3 consecutive handoff→reassess cycles the `persistent + regressed` count does not strictly decrease, a `handoff.convergence_stuck` notify fires at severity `warn`, and the UI rails show a sticky banner.

### Profile enforcement — executor side
Phase 5 adds `executor.code@1.0.0` with a **narrow tool registry** — no connector writes, no shell outside bound workspace, no session spawn. Profile-core enforcement applies exactly the same model as assessors; red-team cases 68–75 cover executor denials.

### Bridge emissions expanded
- `handoff.created` / `handoff.approved` / `handoff.rejected` / `handoff.invalidated` / `handoff.expired`.
- `handoff.dispatch_started` / `handoff.dispatch_progress` / `handoff.dispatch_completed`.
- `handoff.task.started` / `handoff.task.completed` / `handoff.task.failed`.
- `assessment.diff_computed` (new event; payload carries the 4-way classification).
- `handoff.convergence_stuck` (notify-lane sticky).

All additive; no breaking changes.

### Perf budgets (5.6 exit)
- Pin capture (worktree_digest) for 10k-file repo: ≤ 2s p95.
- Pin verify on dispatch: ≤ 1s p95.
- Diff compute for 1k findings × 2 runs: ≤ 150ms.
- HandoffBuilder initial render with 500 selectable findings: ≤ 120ms.
- Bundle post-Phase-5: ≤ 1.25MB gz (modest growth; diff view + builder are the additions).

### Red-team expansion
Phase 5 adds cases 68–90:
- Executor attempts a connector *write* — denied by profile.
- Executor attempts `shell.*` against a path outside the bound workspace — denied.
- Pin drift mid-approval — rejects with `handoff.invalidated`.
- Self-sign attempt — rejects with `handoff.conflict_self_sign`.
- Second signer with mismatched packet id — rejected.
- Convergence stuck 3× — escalation notify fires (assertion on audit log).
- Replay old packet id after expiry — rejected.
- Handoff created against a `hard_expire` evidence set — blocked (carry-forward from Phase 4.4).

Target: **≥ 90 red-team cases green by 5.6 exit**.

### Test targets (Phase 5 exit)
- Workspace (Rust): ≥ 220 tests.
- Red-team: ≥ 90.
- vitest (web): ≥ 135.
- Playwright E2E: ≥ 3 (existing 2 + full loop smoke).

## Phase 5 exit criteria (gate to Phase 6)

From 5.6:

- [ ] All 5.1–5.5 sub-phases hit their individual exit criteria.
- [ ] Full-loop E2E: RTD finding → build packet → two-party approval → dispatch → executor completes → auto-reassess → verdict `fail → pass` → diff view shows prior findings as `resolved`.
- [ ] Pin drift test: modifying the worktree between `handoff.create` and `handoff.approve` rejects with `handoff.invalidated`.
- [ ] Self-sign attempt rejected with `handoff.conflict_self_sign`.
- [ ] Convergence guard: 3× stuck reassess → sticky banner + audit-logged `handoff.convergence_stuck`.
- [ ] Cross-profile chain: a packet dispatched to `executor.code` then the resulting worktree re-assessed by `assessor.rtd` succeeds with no protocol errors.
- [ ] Red-team matrix 1–90 all green.
- [ ] Tests: 220+ workspace / 135+ vitest / 90+ red-team / 3+ Playwright.
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green.
- [ ] Root README + `docs/plans/phase-5/README.md` + each sub-phase README marked ✅.

## Rollback plan

Phase 5 sits on the critical path to Phase 6 and Release plane, so partial rollback must preserve the rest of the cockpit's usefulness.

- **5.1 upstream stalls**: pin verify is undefined; gate Phase 5 execution hard. Do **not** implement against a provisional digest algorithm.
- **5.2 lifecycle instability**: feature-flag `handoff.create` at the bridge boundary; UI degrades to read-only findings. Assessment still runs.
- **5.3 UI flow rough**: ship HandoffBuilder behind a `vac.handoff.enabled` flag; the Readiness Hub remains primary.
- **5.4 dispatch flaky**: disable dispatch button; allow builder + approval through, but hold dispatch until 5.4.1 hotfix.
- **5.5 diff math wrong**: ship the 4-tab view as "Phase 5 preview" with an explicit warning banner until assertions cover the identity-hash edge cases.
- **Convergence false positives** (stuck warnings firing on healthy chains): invert the default — only fire on ≥ 5 cycles — and re-tune in a 5.6-hotfix.

If the pin-verify perf budget blows past 2s for 10k files: adopt a Merkle-tree compute that short-circuits on unchanged directories; fall back to file-list hash if Merkle doesn't ship.

## Execution policy

- Sub-phases run in order. The upstream pin algorithm (5.1) is the one bit that **cannot** be scaffolded — hold for real merge or reach out to the upstream maintainer.
- After each sub-phase: `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm --filter @vac-web/web typecheck && test && build`. Red blocks progression.
- Red-team expansion runs *during* each sub-phase for the cases that sub-phase touches (don't punt all to 5.6).
- Audit cycle after 5.6, matching the Phase 1–4 pattern.
- Budget contingency: if a sub-phase exceeds estimate by > 50%, stop + re-scope. Trim candidates in order: (a) defer connector snapshot binding beyond github, (b) ship with single-signer executor (two-party only for ReadyToDeploy gate), (c) land convergence guard as observe-only (log but don't sticky-banner) until 5.6-hotfix.

## Related

- [`docs/roadmap.md §Phase 5`](../../roadmap.md)
- [`docs/handoff-contract.md`](../../handoff-contract.md) — SSOT for packet schema + pin + approval rules.
- [`docs/assessment-contract.md`](../../assessment-contract.md) — identity hash (must match Phase 4.3 behaviour) + diff semantics.
- [`docs/capability-profiles.md`](../../capability-profiles.md) — `executor.code@1.0.0` profile definition.
- [`docs/upstream-vac-prs.md`](../../upstream-vac-prs.md) — PR #8 scope.
- [`docs/protocol.md`](../../protocol.md) — envelope extensions for handoff events.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — cases 68–90.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs for 5.6.
