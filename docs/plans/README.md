# Implementation Plans

Active implementation plans only. Historical phase/stage docs were removed because they referenced old commits, old stage gates, and behavior that no longer matches the current backend/UI wiring.

Use `git log` for archaeology. Use this directory for work that should guide the next code changes.

## Plan index

All 50 numbered wiring slices (01-50) landed as of Pass #27 audit (2026-05-04). The plan set is now reference material — use it to understand current cockpit shape and architectural intent. New work is tracked in dedicated handoff plans (see *Active handoffs* below).

1. [`wiring/00-index.md`](./wiring/00-index.md) — full split-plan index, all slices landed.
2. [`wiring/30-product-surface-roadmap.md`](./wiring/30-product-surface-roadmap.md) — historical implementation wave ordering.
3. [`backend-ui-wiring.md`](./backend-ui-wiring.md) — compatibility router that points to the split `wiring/` plan set.

## Active handoffs

- [`wiring/post-r1-r6-followups-plan-2026-05-07.md`](./wiring/post-r1-r6-followups-plan-2026-05-07.md) — Phase 2 follow-ups after R1–R6 closeout: F1 (trust real classification, closed), F2 (perf real drivers, planned), F3 (baseline watch, closed), F4 (flip CI strict, deferred), F5 (cockpit UX, planned), F6 (ADR refresh, planned). Status: active 2026-05-07.
- [Cockpit UX implementation plan (2026-05-07)](wiring/cockpit-ux-implementation-plan-2026-05-07.md) — wire release panel, extensions settings page, perf indicator (F5a/F5b/F5c)

## Closed handoffs

- [`wiring/executor-implementation-plan.md`](./wiring/executor-implementation-plan.md) — Pass E1 (audit) + Pass E2 (`spawn_executor_for_handoff` extraction & integration tests). Status: landed 2026-05-06.
- [`wiring/remaining-work-execution-plan-2026-05-06.md`](./wiring/remaining-work-execution-plan-2026-05-06.md) — six remaining work items (R1–R6) covering slices 14, 36, 39, 41, 47, 48 follow-ups. Status: closed 2026-05-06 (all R1–R6 landed).

## Stale (do not cite for new work)

- [`wiring/wave-summary-2026-05-02.md`](./wiring/wave-summary-2026-05-02.md) — historical execution diary, superseded.
- [`wiring/wave-summary-2026-05-03.md`](./wiring/wave-summary-2026-05-03.md) — Passes #1–#16+ execution diary; all work superseded by Pass #37 + 2026-05-06 closeout. Retained only as inbound-link target.

## Workflow-as-code rule

Plans in `wiring/` use VIL-inspired declarative YAML control-plane blocks. The YAML should feel Pythonic for agents/executors: readable, compact, composable, low ceremony, and easy to maintain.

The YAML does **not** replace runtime enforcement. Rust and TypeScript remain the source of truth for ACP, filesystem, terminal, auth, persistence, security, policy, and side effects.

## Planning rules

- Plans must be grounded in current code, not historical milestones.
- A plan must name the backend command/event surface and the frontend component/store that consumes it.
- Every visible UI control must map to either:
  - a real backend executor, or
  - an explicit disabled/not-wired state with operator-facing copy.
- YAML declarative control-plane should describe desired orchestration, source files, dependencies, steps, and acceptance gates.
- Runtime implementation must remain explicit and testable in Rust/TypeScript.
- Avoid phase labels unless they correspond to a current branch or open implementation slice.
- Do not keep completed implementation notes here. Once shipped, summarize behavior in the relevant durable contract doc and let `git log` preserve history.

## Current priority

As of 2026-05-06, all 50 numbered wiring slices (01-50) are landed. The original "make the cockpit truthful before adding product breadth" goal is met. Active focus has shifted to:

1. Executor wiring (handoff dispatch + executor session binding) — see [`wiring/executor-implementation-plan.md`](./wiring/executor-implementation-plan.md).
2. Post-Pass-#27 stale-doc remediation and metadata refresh.
3. New product-surface plans authored as needed; reference the wiring slices for cockpit shape.

_Historical P0 priority order (all landed): command manifest, `feature.not_wired` fallback, protocol/schema/codegen parity, declarative config/capability control-plane, session model/context telemetry, review taxonomy cleanup, profile policy enforcement, auth/WS security, CI validation gates._

## Declarative pattern adoption

Declarative pattern adoption starts at [`wiring/31-declarative-pattern-adoption-audit.md`](./wiring/31-declarative-pattern-adoption-audit.md). Use this before adding new product surfaces or refactoring command/event catalogs.


## Enterprise maturity layer

Enterprise maturity starts at [`wiring/36-enterprise-maturity-scorecard.md`](./wiring/36-enterprise-maturity-scorecard.md). Implementing wiring plans alone is not enough; maturity requires architecture fitness tests, DX scaffolding, generated-code ownership, security/supply-chain controls, observability, data-versioning, and documentation governance.

## External benchmark

Use [`wiring/48-external-best-practice-benchmark.md`](./wiring/48-external-best-practice-benchmark.md) before declaring the control-plane pattern mature. It checks VAC against common best practices from declarative workflow/control-plane ecosystems.

## Final coverage closure

The final repository coverage scan is closed by [`wiring/49-fixtures-scripts-repo-hygiene.md`](./wiring/49-fixtures-scripts-repo-hygiene.md) and [`wiring/50-web-rendering-worker-pipeline.md`](./wiring/50-web-rendering-worker-pipeline.md).
