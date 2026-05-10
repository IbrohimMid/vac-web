# Implementation Plans

Active implementation plans only. Historical phase/stage docs and completed handoff plans are removed from this directory when they stop guiding the next code changes; use `git log -- docs/plans` for archaeology.

## Plan index

All 50 numbered wiring slices (01-50) landed as of Pass #27 audit (2026-05-04). The split wiring set is retained as reference material for current cockpit shape and architectural intent.

1. [`wiring/00-index.md`](./wiring/00-index.md) — full split-plan index, all numbered slices landed.
2. [`wiring/30-product-surface-roadmap.md`](./wiring/30-product-surface-roadmap.md) — historical implementation wave ordering.
3. [`backend-ui-wiring.md`](./backend-ui-wiring.md) — compatibility router that points to the split `wiring/` plan set.

## Active handoffs

- [`active-plans-implementation-2026-05-10.md`](./active-plans-implementation-2026-05-10.md) — P0 orchestration plan that sequences every unfinished active plan: keyboard-nav overlays, minimal gate governance backend, and release-plane backend Phase 6. Status: draft 2026-05-10.
- [`keyboard-nav-overlays-2026-05-10.md`](./keyboard-nav-overlays-2026-05-10.md) — Focus trap + keyboard-equal action handling for 4 cockpit overlays (Release, Handoff, Extensions, Approvals) plus GateDetail. Closes PRD §6 prinsip 1 gap (audit avg keyboard nav 1.8/5). Status: draft 2026-05-10.
- [`release-plane-backend-phase-6.md`](./release-plane-backend-phase-6.md) — Phase 6 backend executors for `release.deploy/publish/generate_notes` + `executor.release` capability profile + audit log + gate enforcement. UI auto-enables via affordance catalog when manifest flips. Status: draft 2026-05-10.

## Recently closed, now removed from active docs

Use `git log -- docs/plans` for the full deleted text. Current durable behavior lives in the relevant contract docs and source files.

- Affordance fake-feature closeout: 8 NotWired buttons are now affordance-gated in the web UI.
- F4 strict perf gate flip: `.github/workflows/perf.yml` now runs strict compare, with `MIN_STRICT_WINDOW = 5` warmup guard in `scripts/perf-baseline-compare.mjs`.
- F2.5 topbar Playwright driver: the real topbar interaction perf scenario is landed.
- Wave 5-6 dependency closeout: dependency decisions are retained in changelog / lockfile / ADR-0005 where still relevant.
- R1-R6, executor handoff, cockpit UX, and post-R1-R6 followups: landed; reference current product/architecture docs instead of historical plans.

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

As of 2026-05-10, all 50 numbered wiring slices (01-50), executor handoff (Pass E1+E2), R1-R6, F1/F2/F3/F4/F5a/F5b/F5c/F6, two trust hardening rounds, F2.5 Playwright driver, Wave 5-6 dependency closeout, and the affordance fake-feature closeout (8 buttons) are landed. F4 strict gate is active with a `MIN_STRICT_WINDOW` warmup guard so it self-loosens until enough history accumulates. Active focus moves to product-surface depth:

1. **Execute the active-plan orchestration** — follow [`active-plans-implementation-2026-05-10.md`](./active-plans-implementation-2026-05-10.md).
2. **Keyboard nav overlays** — closes PRD §6 prinsip 1 gap. See [`keyboard-nav-overlays-2026-05-10.md`](./keyboard-nav-overlays-2026-05-10.md).
3. **Release plane backend Phase 6** — wires `release.deploy/publish/generate_notes` real executors so the UI affordances auto-enable. See [`release-plane-backend-phase-6.md`](./release-plane-backend-phase-6.md).
4. New product-surface plans authored as needed; reference the wiring slices for cockpit shape.

_Historical P0 priority order (all landed): command manifest, `feature.not_wired` fallback, protocol/schema/codegen parity, declarative config/capability control-plane, session model/context telemetry, review taxonomy cleanup, profile policy enforcement, auth/WS security, CI validation gates._

## Declarative pattern adoption

Declarative pattern adoption starts at [`wiring/31-declarative-pattern-adoption-audit.md`](./wiring/31-declarative-pattern-adoption-audit.md). Use this before adding new product surfaces or refactoring command/event catalogs.

## Enterprise maturity layer

Enterprise maturity starts at [`wiring/36-enterprise-maturity-scorecard.md`](./wiring/36-enterprise-maturity-scorecard.md). Implementing wiring plans alone is not enough; maturity requires architecture fitness tests, DX scaffolding, generated-code ownership, security/supply-chain controls, observability, data-versioning, and documentation governance.

## External benchmark

Use [`wiring/48-external-best-practice-benchmark.md`](./wiring/48-external-best-practice-benchmark.md) before declaring the control-plane pattern mature. It checks VAC against common best practices from declarative workflow/control-plane ecosystems.

## Final coverage closure

The final repository coverage scan is closed by [`wiring/49-fixtures-scripts-repo-hygiene.md`](./wiring/49-fixtures-scripts-repo-hygiene.md) and [`wiring/50-web-rendering-worker-pipeline.md`](./wiring/50-web-rendering-worker-pipeline.md).
