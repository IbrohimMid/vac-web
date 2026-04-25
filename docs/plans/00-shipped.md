# Shipped — state of the codebase

Snapshot of what's already in `main` as of commit `cd1ff13`. New plans assume this baseline. For commit-level detail use `git log`.

## Foundations (Phase 0)

- Monorepo bootstrapped (`apps/web`, `apps/bridge`, `packages/protocol`, `packages/cockpit-tokens`, etc.).
- Canonical JSON Schemas + Rust/TS codegen pipeline.
- Profile catalog (`assessor.*`, `executor.code`, `executor.release`, `executor.migration`).
- Red-team test harness, upstream VAC PRs landed, integration readiness verified.

## Bridge + Web MVP (Phase 1)

- Bridge WebSocket transport, session manager, child-process spawn for VAC native engine.
- Translator + Layer-1 profile enforcement (deny-by-default at the bridge boundary).
- Pairing + JWT + audit log integration.
- Web scaffold, WebSocket transport, minimal transcript + composer.
- End-to-end integration verified at the bridge layer; Playwright E2E deferred.

## Build Cockpit Core (Phase 2)

- Transcript architecture (hot/cold split + markdown).
- Shiki syntax highlight in a worker.
- Command palette + ActionSpec.
- Topbar, notify lanes, Activity rail.
- Overlay manager.
- Perf + red-team exit gates met (vitest UI red-team; Playwright perf deferred).

## Phases 3–8

- Assess, Handoff, Release, Knowledge, Sessions, and integration work landed in v1 GA (`df37173`) followed by the audit-driven hardening pass (`18cb543`).

## Cockpit visual port (Stages A–H)

Ported from the `/vacweb` prototype into the live cockpit, gz initial bundle held under 95 KB:

- **A** — visual foundation.
- **B** — shell (sidebar, topbar, rail, 6-route nav).
- **C** — Build surface with split + 8 workbench tabs (Approvals, Review, Agents, Runtime, Plan, VIL, VWFD, Memory).
- **D** — Assess / Handoff / Release / Knowledge / Sessions in cockpit chrome.
- **E** — Tweaks panel + cockpit store tests.
- **F** — Palette + Toast + Composer in cockpit chrome.
- **G** — Run-assessment drawer, real Agents lanes, gate-ring polish.
- **H** — overlay restyles + tool-call rendering + recent assessments.

## Composer + Report detail (Stages I–J)

- **I** — Composer contentEditable + slash palette + inline mention chips, behind `localStorage['vac.composer.experimental']`. Default remains textarea.
  - Patches: slash trigger via pure `composer/triggers.ts`, Enter routing via `submitDisabled`, single `markUsed` owner.
- **J** — AssessmentReport detail in-place toggle in `ReadinessHub`, new `assessmentReport` slice, extracted `FindingsList`.
  - Patches: Rules-of-Hooks split into `ReadinessHub` wrapper + `ReadinessHubMain`; HandoffBuilder prefill via `visibleHandoffFindings` union (active-run medium+ ∪ any selected) with `carryover` badge.

## Stability fixes

- React #185 in `RunAssessmentDrawer` resolved at `1aa94f8` — Map-ref selector + `useMemo` instead of `Array.from` inside the Zustand selector. Regression covered by `apps/web/src/stores/connectors.test.ts`.

## Architecture lock — Stage X.0

- [`../agent-runtime.md`](../agent-runtime.md) at commit `cd1ff13`: design lock for the AgentRuntime registry (drivers `mock` | `vac-native` | `acp`), additive `agent_id` on `session.create`, profile `allowed_agent_kinds`, ACP ↔ VAC permission/approval bridge, audit format, red-team cases 121–132.
- Claude Code `--acp` flag flagged **PROVISIONAL/unverified** until handshake test against a real Claude binary lands.
- Stages X.1–X.8 queued — see [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md).

## Held / not started

- **Stage K (VIL / VWFD live integration)** — placeholder UI only; held pending upstream `vil-expr` event names + schemas. See [`30-stage-k-vil-vwfd.md`](./30-stage-k-vil-vwfd.md).
- **Playwright E2E + perf** — deferred; vitest covers unit + UI red-team.
- **Connector `jira` adapter** — slated for v1.1.
