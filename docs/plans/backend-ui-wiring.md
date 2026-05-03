# Backend ↔ UI Wiring Plan Router

The monolithic wiring plan has been split into focused plan slices under [`wiring/`](./wiring/).

Start here:

- [`wiring/00-index.md`](./wiring/00-index.md) — full split-plan index.
- [`wiring/30-product-surface-roadmap.md`](./wiring/30-product-surface-roadmap.md) — implementation waves.

## Design rule

Use VIL-inspired workflow-as-code patterns for the declarative control plane: YAML should be Pythonic, low-ceremony, composable, and easy for agents/executors to maintain. The YAML describes desired orchestration and acceptance criteria; Rust and TypeScript remain the runtime source of truth for ACP, filesystem, terminal, auth, persistence, security, and side effects.

## Why split

The previous monolith mixed command manifest work, frontend affordance gating, workflow engine concerns, protocol/codegen drift, auth/security, persistence, mock-engine parity, and product surface rollout. The split plan set makes each slice independently implementable and testable.

## Current P0 slice order

1. [`wiring/01-command-manifest.md`](./wiring/01-command-manifest.md)
2. [`wiring/02-not-wired-fallback.md`](./wiring/02-not-wired-fallback.md)
3. [`wiring/19-protocol-schema-parity.md`](./wiring/19-protocol-schema-parity.md)
4. [`wiring/25-codegen-sdk-drift.md`](./wiring/25-codegen-sdk-drift.md)
5. [`wiring/27-config-capabilities-control-plane.md`](./wiring/27-config-capabilities-control-plane.md)
6. [`wiring/03-session-model-context.md`](./wiring/03-session-model-context.md)
7. [`wiring/05-review-taxonomy.md`](./wiring/05-review-taxonomy.md)
8. [`wiring/20-profile-policy-enforcement.md`](./wiring/20-profile-policy-enforcement.md)
9. [`wiring/21-auth-ws-security.md`](./wiring/21-auth-ws-security.md)
10. [`wiring/28-ci-validation-gates.md`](./wiring/28-ci-validation-gates.md)

## Declarative pattern adoption

- [`wiring/31-declarative-pattern-adoption-audit.md`](./wiring/31-declarative-pattern-adoption-audit.md) — audit source surfaces that still need YAML control-plane adoption.
- [`wiring/32-command-event-catalog-generation.md`](./wiring/32-command-event-catalog-generation.md) — generate command/event catalogs and typed bindings.
- [`wiring/33-frontend-declarative-affordances.md`](./wiring/33-frontend-declarative-affordances.md) — move UI affordances into declarative capability-gated metadata.
- [`wiring/34-mock-scenario-yaml.md`](./wiring/34-mock-scenario-yaml.md) — migrate mock scenarios toward YAML parity.
- [`wiring/35-workflow-authoring-rules.md`](./wiring/35-workflow-authoring-rules.md) — author workflow intent as YAML before runtime implementation.


## Enterprise maturity layer

The wiring/control-plane plan set is necessary but not sufficient for an enterprise-grade repo. The maturity layer tracks architecture fitness, DX, testing, security, observability, data contracts, generated-code ownership, docs governance, and extension boundaries.

- [`wiring/36-enterprise-maturity-scorecard.md`](./wiring/36-enterprise-maturity-scorecard.md) — scorecard for mature, clean, maintainable architecture.
- [`wiring/37-module-boundaries-layering.md`](./wiring/37-module-boundaries-layering.md) — dependency and layer fitness tests.
- [`wiring/39-dx-tooling-scaffolding.md`](./wiring/39-dx-tooling-scaffolding.md) — scaffolding and one-command checks for high-velocity implementation.
- [`wiring/42-testing-strategy-pyramid.md`](./wiring/42-testing-strategy-pyramid.md) — test taxonomy and contract gates.
- [`wiring/43-security-supply-chain.md`](./wiring/43-security-supply-chain.md) — security and dependency governance.
- [`wiring/47-extension-plugin-boundaries.md`](./wiring/47-extension-plugin-boundaries.md) — safe future extensibility boundaries.

## External best-practice benchmark

- [`wiring/48-external-best-practice-benchmark.md`](./wiring/48-external-best-practice-benchmark.md) — compares the VAC plan set against Argo Workflows, Tekton, Crossplane, Backstage, OPA, GitHub Actions Runner, and Dagger patterns.

## Final coverage closure

- [`wiring/49-fixtures-scripts-repo-hygiene.md`](./wiring/49-fixtures-scripts-repo-hygiene.md) — covers fixtures, scripts, schema/v1, config root files, integration tests, and GitHub repo hygiene assets found in the final scan.
- [`wiring/50-web-rendering-worker-pipeline.md`](./wiring/50-web-rendering-worker-pipeline.md) — covers web rendering support modules such as composer internals, markdown, highlight, transcript, workers, bootstrap, and Vite env typing.
