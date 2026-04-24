# Phase 4 — Assessment MVP (RTD + PM)

**Total duration**: ~15 days (7 sub-phases, 6 granular plans)
**Position**: after Phase 3.7 (execution surfaces green); before Phase 5 (Handoff + Reassess loop)
**Status**: 🔴 **NOT STARTED**

## Goal

Turn the cockpit's execution surfaces into an **actually-useful assessor workstation**: the user can run the RTD (Ready-to-Deploy) and PM (Product-Market) assessment swarms against a real project, get a verdict with clickable evidence in ≤ 3 minutes, and see release gates transition based on the result.

Four tracks converge:

1. **Upstream contract** — VAC PRs #6 (`evidence.capture` tool) and #7 (`finding.emit` + AssessmentRun lifecycle) land; two swarm catalogs (RTD: 5 agents + `release_gate` synthesizer; PM: 7 agents + synthesizer) ship under `crates/vac_core/assets/swarms/`.
2. **Bridge assessment pipeline** — run manager orchestrates multi-agent swarms, findings stream through an identity-hash dedup, evidence captures with freshness policies, verdict synthesis + persistence.
3. **Web readiness surface** — Readiness Hub (5 scorecards: Technical / Product / UX / Release / Ops), AssessmentReport with virtualized findings list, FindingCard with lazy evidence preview, freshness badges, streaming progress.
4. **Gate system** — `DevComplete` and `ReadyToDeploy` gates wired to verdict changes, GateRibbon in Topbar, override dialog with two-party signoff, full audit trail UI.

Exit: run RTD on a real project → verdict in ≤ 3 min, every finding has ≥ 1 clickable `EvidenceRef`, zero connector *writes* during any assessor run (verified in audit log), stale evidence visibly badged, `ReadyToDeploy` transitions correctly, red-team matrix 1–67 green.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plan |
|---|---|---|---|
| **4.1** | Upstream VAC PRs (#6 evidence.capture, #7 finding.emit + AssessmentRun) | 3 | [31-rtd-pm-swarms](./31-rtd-pm-swarms.md) §upstream |
| **4.2** | Assessment run manager (bridge lifecycle) | 2 | [26-assessment-run-manager](./26-assessment-run-manager.md) |
| **4.3** | Finding + evidence pipeline (identity hash, capture, preview) | 2.5 | [27-finding-evidence](./27-finding-evidence.md) |
| **4.4** | Freshness enforcement (policies, hard_expire, badges) | 1.5 | [28-freshness-enforcement](./28-freshness-enforcement.md) |
| **4.5** | Readiness Hub + AssessmentReport UI | 3 | [29-readiness-hub-ui](./29-readiness-hub-ui.md) |
| **4.6** | Gate system (DevComplete / ReadyToDeploy + GateRibbon + override) | 2 | [30-gate-system](./30-gate-system.md) |
| **4.7** | RTD + PM swarm agents + `release_gate` synthesizer | 1 | [31-rtd-pm-swarms](./31-rtd-pm-swarms.md) |
| **4.8** | Perf gates + full red-team matrix (1–67) + exit sweep | 1 | — |

## Critical path

```
4.1 ──▶ 4.2 ──▶ 4.3 ──▶ 4.4 ──▶ 4.5 ──▶ 4.6 ──▶ 4.7 ──▶ 4.8
             ▲
             └── 4.2/4.3/4.4 can partly overlap once 4.1's contract types are merged.
```

- **4.1 first** — nothing in the bridge or web can be implemented against unmerged upstream contracts. Schemas must be frozen and codegen regenerated before bridge work starts.
- **4.2 then 4.3** — run manager owns the lifecycle; the finding/evidence pipeline consumes that lifecycle's events. Can start 4.3 as soon as run manager emits its first findings.
- **4.4 follows 4.3** — freshness policies wrap evidence refs; meaningless without an evidence pipeline.
- **4.5 only once 4.2–4.4 emit stable events** — the UI is a consumer. Can build skeletons earlier behind feature flags if calendar demands.
- **4.6 Gates** reads verdicts; needs 4.5's scoring surface to already exist in the store.
- **4.7 Swarms** is the smallest slice but the highest-value — with the pipeline in place, actual assessor agents unlock the exit criteria.
- **4.8 Exit sweep** — only meaningful once all surfaces are live.

## Prerequisites

- Phase 3.7 green: Workbench tabs, Shell, Connectors operational.
- Upstream `vastar-agentic-cli` main branch at a commit where PRs #6 and #7 are mergeable (scaffolding from Phase 0.5 upstream-vac-prs.md still valid).
- `crates/vac_core/assets/swarms/` directory exists on the upstream side.
- Phase 0 docs locked: `assessment-contract.md`, `evidence-freshness.md`, `gates.md`.
- Connectors operational at minimum for `github` (diff/PR context, Actions), `notion` (docs evidence). Ideal: `sentry` (observability evidence) + `ci` (GitHub Actions) for RTD; `linear` + `figma` helpful for PM.

## What's explicitly OUT of Phase 4

- **Handoff builder + Reassess loop** — Phase 5.
- **Release plane + gate override audit log viewer polish** — Phase 6.
- **Remaining assessor families** (SEC, UX, OPS) — Phase 6.
- **Hosted dispatch (web-CLI)** — Phase 7.
- **Continuous readiness / scheduled reassessments** — Phase 8.
- **AssessmentDiff** (resolved / persistent / regressed / new tabs) — Phase 5 (needs handoff-driven re-runs to be meaningful).
- **Connector writes of any kind from assessor sessions** — contract forbids it; Phase 4 enforces read-only.

## Cross-cutting concerns

### Upstream ↔ bridge ↔ web contract surface
Phase 4 is the first phase with **three-sided contract evolution**:

1. Upstream (Rust) emits new JSON-RPC methods: `evidence.capture`, `finding.emit`, `assessment.run.progress`, `assessment.run.completed`.
2. Bridge must reject unknown methods until upstream is at a version that supports them (`system.version` negotiation at session boot).
3. Web consumes new event types: `assessment.progress`, `assessment.finding`, `assessment.completed`, `assessment.evidence_preview`, `gate.changed`.

All new types get schemas under `packages/protocol/v1/` + regenerated via `scripts/codegen.sh`. No breaking changes to existing envelopes.

### Identity hash + finding dedup
Findings carry a stable `identity_hash = sha256(category|subject|check)` (spec: `docs/assessment-contract.md §3`). Bridge maintains a per-run index; repeat emissions with the same hash update, not duplicate. Critical for reassess diff in Phase 5 — the hash must be computed identically on first run and subsequent runs.

### Freshness policies (new bridge module)
`docs/evidence-freshness.md §4` defines four TTL tiers: `fresh | aging | stale | hard_expire`. Bridge computes tier on read; web renders badges. `hard_expire` **blocks handoff creation** in Phase 5 — the enforcement lives here in 4.4.

### Profile enforcement full coverage
Phase 4 is when the profile-core enforcement moves from "subset policy" to "full coverage" — every assessor tool call is gated. Profiles shipped: `assessor.base@1.0.0`, `assessor.rtd@1.0.0`, `assessor.pm@1.0.0`. Red-team matrix cases 1–67 must be green.

### Perf budgets (enforced at 4.8 exit)
- Verdict latency (RTD standard depth): ≤ 3 min p95 on a 10k-LOC project.
- AssessmentReport initial render with 1k findings: ≤ 200ms.
- Virtualized findings list scroll FPS p95: ≥ 55 with 10k findings.
- Evidence preview lazy-fetch latency: ≤ 120ms p95.
- Memory: no growth > 40MB during a full RTD run.
- Bundle post-Phase-4: ≤ 1.1MB gz (report + hub are the big additions).

### Red-team expansion
Phase 4 unlocks the full matrix from `docs/red-team-test-plan.md` (cases 1–67). New case families:
- Assessor profile denies all connector writes (one case per write-capable connector).
- `finding.emit` with malformed identity hash rejected.
- `evidence.capture` from a forbidden connector rejected.
- Stale evidence auto-downgrades finding confidence.
- `hard_expire` evidence blocks verdict promotion.
- Swarm agent attempting `shell.*` from within an assessor session denied.

Target: **full 67 cases green by 4.8 exit**.

### Test targets (Phase 4 exit)
- Workspace (Rust): ≥ 180 tests.
- Red-team: ≥ 67 (full matrix).
- vitest (web): ≥ 110 tests.
- Playwright E2E: ≥ 2 green runs (RTD happy path + stale-evidence badge).

## Phase 4 exit criteria (gate to Phase 5)

From 4.8:

- [ ] All 4.1–4.7 sub-phases hit their individual exit criteria.
- [ ] E2E smoke: `pair → session → assessment.run(rtd) → findings stream → verdict delivered → gate.changed(DevComplete → pass) → ReadyToDeploy stays blocked pending signoff`.
- [ ] Verdict p95 ≤ 3 min on a 10k-LOC reference project.
- [ ] Zero connector writes during an assessor run (audit log assertion in test).
- [ ] Every finding in a sample RTD run has ≥ 1 clickable `EvidenceRef`.
- [ ] Stale evidence badge visible on a synthetically-aged run.
- [ ] `hard_expire` evidence correctly blocks `ReadyToDeploy` promotion.
- [ ] Red-team matrix 1–67 all green.
- [ ] Tests: 180+ workspace / 110+ vitest / 67+ red-team / 2+ Playwright.
- [ ] Clippy `-D warnings` + fmt + TS strict + vite build all green.
- [ ] Root README + `docs/plans/phase-4/README.md` + each sub-phase README marked ✅.

## Rollback plan

Phase 4 is large and the upstream dependency is the highest-risk surface.

- **4.1 upstream stalls**: the rest of Phase 4 is blocked. Hold web/bridge work; don't implement against mock schemas that will drift. Escalate immediately.
- **4.2 run manager instability**: feature-flag `assessment.run` at the bridge boundary; return `protocol.not_implemented` so the UI degrades cleanly.
- **4.3/4.4 pipeline issues**: evidence/freshness can ship disabled with `hard_expire` treated as `stale`; degrades the assertion, does not break the flow.
- **4.5 UI issues**: Readiness Hub hidden behind a flag; user still has Workbench tabs from Phase 3.
- **4.6 Gate system bugs**: gates can be shipped in "observe-only" mode (render but do not block handoff) — block-enforcement flips on in Phase 5.
- **4.7 swarm agent regressions**: the swarm catalog is data — a single agent can be disabled via catalog edit without re-deploying bridge/web. Synthesizer fails soft to `unknown` verdict if < quorum of agents completed.

If perf budget blows past 3-min verdict: profile run manager hot path + consider parallelism raise (agents-per-run); defer per-agent progress streaming to post-4.8.

## Execution policy

- Execute sub-phases in order. 4.2 / 4.3 / 4.4 may overlap moderately *after* 4.1 contracts are frozen — same-session work, not separate sessions.
- After each sub-phase: `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm --filter @vac-web/web typecheck && test && build`. Red blocks progression.
- Because Phase 4 spans two repos, end-of-sub-phase checkpoint = **both** repos clean and the integration smoke scenario still runs.
- Audit cycle after 4.8 (reviewer / architect lens), matching the Phase 1–3 post-audit hardening pattern.
- Budget contingency: if a sub-phase exceeds estimate by > 50%, stop + re-scope. Likely scope-trim candidates in order: (a) reduce PM swarm to 5 agents from 7, (b) defer Sentry connector to Phase 4.5-hotfix, (c) ship `ReadyToDeploy` signoff without two-party (single-signer v0).

## Related

- [`docs/roadmap.md §Phase 4`](../../roadmap.md) — scope in roadmap context.
- [`docs/assessment-contract.md`](../../assessment-contract.md) — SSOT for AssessmentRun / Finding / Verdict / identity hash.
- [`docs/evidence-freshness.md`](../../evidence-freshness.md) — TTL tiers + `hard_expire` semantics.
- [`docs/gates.md`](../../gates.md) — gate state machine + override rules.
- [`docs/capability-profiles.md`](../../capability-profiles.md) — assessor profiles + full-coverage enforcement.
- [`docs/protocol.md`](../../protocol.md) — envelope extensions for assessment events.
- [`docs/upstream-vac-prs.md`](../../upstream-vac-prs.md) — PR #6 / #7 scopes.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — full matrix (cases 1–67).
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs feeding 4.8.
