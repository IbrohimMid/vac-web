# Implementation Plans

Active implementation plans only. Historical phase/stage docs were removed because they referenced old commits, old stage gates, and behavior that no longer matches the current backend/UI wiring.

Use `git log` for archaeology. Use this directory for work that should guide the next code changes.

## Active plan set

1. [`wiring/00-index.md`](./wiring/00-index.md) — full split-plan index for backend ↔ UI wiring work.
2. [`wiring/30-product-surface-roadmap.md`](./wiring/30-product-surface-roadmap.md) — implementation waves and recommended ordering.
3. [`backend-ui-wiring.md`](./backend-ui-wiring.md) — compatibility router that points to the split `wiring/` plan set.

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

The current priority is to make the cockpit truthful before adding product breadth:

1. Command implementation manifest.
2. Structured `feature.not_wired` fallback.
3. Protocol/schema/codegen parity.
4. Declarative config/capability control-plane.
5. Session model/context telemetry.
6. Review taxonomy cleanup.
7. Profile policy enforcement.
8. Auth/WS security.
9. CI validation gates.

## Declarative pattern adoption

Declarative pattern adoption starts at [`wiring/31-declarative-pattern-adoption-audit.md`](./wiring/31-declarative-pattern-adoption-audit.md). Use this before adding new product surfaces or refactoring command/event catalogs.


## Enterprise maturity layer

Enterprise maturity starts at [`wiring/36-enterprise-maturity-scorecard.md`](./wiring/36-enterprise-maturity-scorecard.md). Implementing wiring plans alone is not enough; maturity requires architecture fitness tests, DX scaffolding, generated-code ownership, security/supply-chain controls, observability, data-versioning, and documentation governance.

## External benchmark

Use [`wiring/48-external-best-practice-benchmark.md`](./wiring/48-external-best-practice-benchmark.md) before declaring the control-plane pattern mature. It checks VAC against common best practices from declarative workflow/control-plane ecosystems.

## Final coverage closure

The final repository coverage scan is closed by [`wiring/49-fixtures-scripts-repo-hygiene.md`](./wiring/49-fixtures-scripts-repo-hygiene.md) and [`wiring/50-web-rendering-worker-pipeline.md`](./wiring/50-web-rendering-worker-pipeline.md).
