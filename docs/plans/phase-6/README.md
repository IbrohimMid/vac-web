# Phase 6 — Remaining assessors + Release plane

**Total duration**: ~15 days (7 sub-phases, 2 granular plans in `plans/phase-6-8/`)
**Position**: after Phase 5.6 (handoff loop green); before Phase 7 (Hosted dispatch)
**Status**: 🔴 **NOT STARTED**

## Goal

Two convergent expansions make Phase 6 the inflection point where vac-web turns from "MVP cockpit" into a complete build → release product:

1. **Complete the assessor catalog.** Phase 4 shipped RTD + PM. Phase 6 ships the remaining **10 families**: UX, Frontend, Security, Reliability, Performance, QA, Docs, Launch, Release, Growth. Each family = swarm catalog YAML + profile + synthesizer + depth presets (quick / standard / deep).
2. **Release plane.** Deploy, Publish, Runbooks generator, Release Notes generator, Post-release Monitor. This is where `ReadyToDeploy` + `ReadyToPublish` gates become actual deploy/publish actions against an `executor.release@1.0.0` session. Two-party approval (Phase 5) becomes load-bearing on Deploy.

Plus four smaller tracks converge: additional gates (`QAComplete`, `ReadyForStaging`, `ReadyToPublish`, `ReadyForGrowth`), advanced read-only workbench tabs (Plan / VIL / VWFD / Signal / Memory), session export/import + context inspector, and ten new connector adapters (Datadog, Grafana, Vercel, Cloudflare, PostHog, GA4, Mixpanel, Snyk, Dependabot, Lighthouse CI, PagerDuty).

Exit: running all 12 assessor families against a real project returns individual verdicts per family; Deploy via web tags + pushes using `executor.release@1.0.0` with two-party approval; generated Release Notes match the real commit history for the current changeset.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **6.1** | Assessor family template + shared synthesizer plumbing | 1.5 | [36-assessor-families-playbook](../phase-6-8/36-assessor-families-playbook.md) §template |
| **6.2** | Ship assessors: UX + Frontend + Security + Reliability + Performance (5 families) | 4 | [36-assessor-families-playbook](../phase-6-8/36-assessor-families-playbook.md) |
| **6.3** | Ship assessors: QA + Docs + Launch + Release + Growth (5 families) | 4 | [36-assessor-families-playbook](../phase-6-8/36-assessor-families-playbook.md) |
| **6.4** | Additional gates wiring (`QAComplete`, `ReadyForStaging`, `ReadyToPublish`, `ReadyForGrowth`) + GateRibbon overflow | 1 | — |
| **6.5** | Release plane: Deploy page + `executor.release@1.0.0` + gate guards + two-party dispatch | 2 | [37-release-plane](../phase-6-8/37-release-plane.md) |
| **6.6** | Release plane: Publish + Runbooks generator + Release Notes + Post-release Monitor | 1.5 | [37-release-plane](../phase-6-8/37-release-plane.md) |
| **6.7** | Advanced read-only tabs (Plan / VIL / VWFD / Signal / Memory) + session export/import + context inspector | 1 | — |
| **6.8** | New connectors (10 adapters, OAuth shells + health surfacing) + red-team cases 91–120 + exit sweep | 1 | — |

## Critical path

```
6.1 ──▶ 6.2 ─┐
             ├─▶ 6.4 ──▶ 6.5 ──▶ 6.6 ──▶ 6.7 ──▶ 6.8
6.1 ──▶ 6.3 ─┘
```

- **6.2 and 6.3 parallelize** once 6.1 ships the family template. Each assessor family is independent YAML + profile work; two concurrent sessions can land 5 families each. Unlike earlier phases, Phase 6 is the first that **benefits** from parallelism: the risk of drift is low because the template is the canonical shape.
- **6.4 before 6.5** — new gates feed the Release plane's guard logic.
- **6.5 before 6.6** — Deploy is the anchor; Publish and the generators extend that surface.
- **6.7 late** — advanced tabs are read-only MVP; they consume state that 6.1–6.6 populate.
- **6.8 last** — connectors feed evidence for the new assessor families; ship them after families so red-team coverage reflects real connector gates.

## Prerequisites

- Phase 5.6 green: full handoff+reassess loop, 90+ red-team cases, 220+ workspace tests.
- `executor.code@1.0.0` profile stable (Phase 5.1 upstream PR #8).
- New upstream profile required: **`executor.release@1.0.0`** — ships with a narrow tool registry (tag, push, deploy, rollback; no arbitrary shell). Dependency tracking on upstream PR #9 (scope-bundle); hold if not merged.
- Pin semantics (Phase 5.2) stable — every deploy dispatch is pinned.
- Connector infrastructure (Phase 3.5 + 4.1) supports new adapters without refactor.
- Gate system (Phase 4.6) handles ≥ 6 gates without UI overflow (Topbar ribbon may need a "more" fold).

## What's explicitly OUT of Phase 6

- **Hosted dispatch / relay / remote attach** — Phase 7.
- **Continuous readiness scheduler / watchdog** — Phase 8.
- **`executor.migration@1.0.0` profile** — Phase 8.
- **Assessor diff across families** — the Phase 5 diff works *per* family; cross-family rollup is Phase 8.
- **Guided mode (non-technical user walkthrough)** — Phase 8.
- **Interactive Runbook authoring / editing** — v1 Runbooks is generator-only; edits land post-v1.

## Cross-cutting concerns

### Assessor family template
Each family ships as:
- `swarms/<family>.yaml` — agents + synthesizer definition + tool hints.
- Profile YAML: `assessor.<family>@1.0.0` — read-only connector subset + bounded shell.
- Synthesizer: a standard header (`verdict`, `score{}`, `confidence`) plus family-specific rollup logic. Shared plumbing lives in `assessment/synthesizer_core.rs`.
- Depth presets: `quick` (60s p95), `standard` (3min p95), `deep` (10min p95).

Ten families × ~1 day of config + 0.5 day of synthesizer logic. Template in 6.1 cuts per-family time by ~40%.

### Profile enforcement — scale test
With ≥ 13 profiles active (3 assessors from Phase 4 + 10 new assessors + executor.code + executor.release + executor.base), profile-core enforcement is exercised at a scale it has not yet seen. Audit spot-check 6.1: compile a profile matrix in CI that asserts every tool-call in every profile's **deny** list is rejected at bridge boundary with `profile.denied`. Existing red-team cases 1–90 carry forward; new 91–120 cover the new profiles.

### Release plane architecture
```
ReadyToDeploy gate (pass) ──▶ DeployPage (target + strategy)
                               ├─▶ handoff.create → executor.release
                               ├─▶ two-party approval
                               ├─▶ dispatch (pin verify)
                               └─▶ post-deploy ReleaseNotes + Monitor attach
```

Deploy must:
- Guard on **every** relevant gate (`DevComplete` + `ReadyToDeploy` + `ReadyForStaging` if staging).
- Capture deploy target (environment, region, strategy) into the packet's pin context.
- Refuse to dispatch if pin drift detected between approval and dispatch (inherit from Phase 5.2).
- Emit `release.deployed` event on success with target + commit + timestamp for audit.

Publish (6.6) is the go-public action: announcements, feature flags flip, store submissions. Same shape as Deploy with `ReadyToPublish` gate.

### Release Notes generator
Pulls from:
- Git log since last `release.deployed` on the same target.
- Handoff packets dispatched in that window (task titles + finding IDs).
- Connector events: Sentry regressions cleared, Datadog incidents resolved.

Output is a reviewable markdown draft in a `release_notes` overlay; author can edit before publish. Never auto-posted without signoff.

### Read-only workbench tabs (6.7)
Plan / VIL / VWFD / Signal / Memory surfaces consume:
- **Plan** — handoff packet history + dispatched tasks.
- **VIL** (Verifiable Intent Ledger) — append-only log of all gate transitions + deploy events.
- **VWFD** (View of What's Flowing Downstream) — reassess chains visible from current branch.
- **Signal** — Sentry + Datadog + PagerDuty rolled into a single severity lane.
- **Memory** — context inspector + session exports; export produces a portable `.vacz` bundle.

All read-only in v1 (no mutation commands); edit/author flows land Phase 8+.

### Bridge emissions expanded
- `assessment.started` payload carries `family: <name>` (was `swarm: rtd|pm` in Phase 4 — widen enum, not rename, to preserve back-compat).
- `release.deploy_started` / `release.deploy_progress` / `release.deployed` / `release.deploy_failed`.
- `release.publish_started` / `release.published`.
- `release.notes_draft` (payload: markdown + source refs).
- `release.post_deploy_observation` (from Sentry/Datadog/PagerDuty).
- Ten connector-specific `connector.<id>.health` event namespaces.

All additive.

### Perf budgets (6.8 exit)
- Full swarm run for any family at standard depth: ≤ 3 min p95 (matches Phase 4 budget).
- Deploy dispatch latency (from approval → executor session spawn): ≤ 4s p95.
- Release Notes generation for 200-commit window: ≤ 2s.
- Gate ribbon with 6 pills + overflow fold: no layout shift on resize.
- Bundle post-Phase-6: ≤ 1.45MB gz.
- Memory: no growth > 60MB during a full 12-family parallel run.

### Red-team expansion (cases 91–120)
- Each of 10 new assessor profiles attempts a connector **write** — all denied.
- Each new gate attempts override by a signer count below threshold — denied.
- `executor.release` attempts `shell.*` outside bound workspace — denied.
- Release Notes generator receives malicious commit message (script tags) — sanitized before render (DOMPurify on the draft overlay).
- Post-deploy Monitor connector webhooks with replayed payloads — rejected by nonce check.
- Deploy without `ReadyToDeploy` pass — blocked at bridge with `gate.denied`.
- Publish without `ReadyToPublish` — blocked.
- Cross-family finding collision (same identity_hash emitted from two assessor sessions) — second rejected with `finding.duplicate_hash`.

Target: **≥ 120 red-team cases green by 6.8 exit**.

### Test targets (Phase 6 exit)
- Workspace (Rust): ≥ 290 tests.
- Red-team: ≥ 120.
- vitest (web): ≥ 175.
- Playwright E2E: ≥ 5 (existing 3 + `full assessor matrix` + `deploy happy path`).

## Phase 6 exit criteria (gate to Phase 7)

From 6.8:

- [ ] All 6.1–6.7 sub-phases hit their individual exit criteria.
- [ ] Full-loop E2E: project → all 12 assessor families run → verdicts delivered → gates transition → Deploy page shows green → handoff packet → two-party approve → dispatch → `release.deployed` → Release Notes draft populated from real commits.
- [ ] Publish path works for a sample artifact (e.g. static site to a staging bucket via `executor.release@1.0.0`).
- [ ] Runbook generator produces a valid runbook for at least one deploy target from the packet + pin.
- [ ] Post-release Monitor attaches Sentry + Datadog observations within 5 min of deploy event.
- [ ] Profile matrix CI: every deny-listed tool in every profile rejected at the bridge with `profile.denied`.
- [ ] Red-team matrix 1–120 all green.
- [ ] Tests: 290+ workspace / 175+ vitest / 120+ red-team / 5+ Playwright.
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green.
- [ ] Root README + `docs/plans/phase-6/README.md` + each sub-phase README marked ✅.

## Rollback plan

- **6.1 template drift**: block — do not land families until the template is frozen. Drift across 10 families is the highest-risk failure mode in Phase 6.
- **6.2 / 6.3 family regressions**: ship remaining families behind `assessor.<family>.enabled` flags; a bad family should not block the batch.
- **6.4 gate overflow UI**: fall back to a single gate dropdown in the Topbar if the pill ribbon overflows; keep flat pills as the default until 6.7.
- **6.5 Deploy page instability**: feature-flag Deploy; keep Readiness Hub + handoff loop usable. Never ship a Deploy that can dispatch without gate guard.
- **6.6 Release Notes generator bugs**: degrade to a "commit list only" MVP — better than wrong summaries. Draft overlay always editable before publish.
- **6.7 advanced tab crashes**: hide the tab; Plan/VIL/VWFD are read-only so a crash is cosmetic but user-visible.
- **6.8 connector OAuth failures**: each connector is additive; disable the failing adapter and keep the rest.

If performance budget slips (likely candidate: 12-family parallel run): introduce per-family concurrency caps (max 4 families simultaneously) rather than reducing family count; the catalog is the product.

## Execution policy

- 6.1 runs solo before 6.2/6.3. 6.2 and 6.3 may run in parallel sessions once 6.1 freezes the family template.
- After each sub-phase: `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm --filter @vac-web/web typecheck && test && build`. Red blocks progression.
- Red-team cases for each new family land **with** that family, not deferred to 6.8.
- Audit cycle after 6.8, matching the Phase 1–5 pattern.
- Budget contingency: if Phase 6 exceeds 15 days by > 30%, trim in this order: (a) defer Growth + Docs families to Phase 8, (b) ship Publish as stub CTA (navigates to external URL) without full dispatch, (c) ship read-only tabs (6.7) as one single "Archive" tab with a filter selector.

## Related

- [`docs/roadmap.md §Phase 6`](../../roadmap.md)
- [`docs/assessment-contract.md`](../../assessment-contract.md) — synthesizer header contract + verdict rules.
- [`docs/capability-profiles.md`](../../capability-profiles.md) — profile schema for new families + `executor.release@1.0.0`.
- [`docs/gates.md`](../../gates.md) — new gate state machines.
- [`docs/handoff-contract.md`](../../handoff-contract.md) — unchanged; Deploy/Publish reuse the packet shape.
- [`docs/connectors.md`](../../connectors.md) — adapter trait for the 10 new connectors.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — cases 91–120.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs for 6.8.
- Parent plans: [`phase-6-8/36-assessor-families-playbook.md`](../phase-6-8/36-assessor-families-playbook.md), [`phase-6-8/37-release-plane.md`](../phase-6-8/37-release-plane.md).
