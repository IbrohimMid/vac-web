---
id: wiring.testing_strategy_pyramid
title: 'Testing strategy pyramid and contract gates'
priority: P0
area: testing
owners:
  - qa
  - bridge
  - web
  - protocol
status: landed  # Pass #25b audit: confirmed via artifacts ['tests/red-team', 'apps/web/src/components/Composer/Composer.render.test.tsx']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Testing strategy pyramid and contract gates

Define a clean testing pyramid across unit, contract, integration, e2e, red-team, perf, generated parity, and docs checks.

## Workflow-as-code control plane

```yaml
slice: wiring.testing_strategy_pyramid
priority: P0
area: testing
owners:
  - qa
  - bridge
  - web
  - protocol
depends_on:
  - wiring.ci_validation_gates
sources:
  - apps/web/src/**/*.test.tsx
  - apps/local-bridge/tests
  - packages/*/tests
  - tests/red-team
  - tools/mock-engine
  - docs/perf-test-plan.md
  - docs/red-team-test-plan.md
outputs:
  - docs/testing-strategy.md
  - scripts/vac-test-matrix.mjs
steps:
  - id: step_01
    do: 'Inventory current test suites and what each protects.'
  - id: step_02
    do: 'Define which tests are required for each plan type.'
  - id: step_03
    do: 'Add test labels/categories for fast local vs full CI.'
  - id: step_04
    do: 'Add contract tests for command/event catalogs and schemas.'
acceptance:
  - 'Contributors know which tests to add for each change type.'
  - 'CI catches schema/catalog/handler/UI drift.'
  - 'Fast local loop remains practical for agents.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Test categories

```yaml
test_matrix:
  web_unit: component/store/domain reducers
  bridge_unit: command handlers and policy decisions
  contract: schema/catalog/generated parity
  integration: websocket/session/ACP/mock flows
  e2e: cockpit flows across UI and bridge
  red_team: policy bypass and injection attempts
  perf: latency/render/persistence budgets
  docs: local link and stale reference checks
```

This makes maturity measurable without requiring every change to run every expensive suite locally.
