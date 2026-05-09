---
id: wiring.module_boundaries_layering
title: 'Module boundaries and layering fitness tests'
priority: P0
area: architecture-fitness
owners:
  - architecture
  - bridge
  - web
status: landed  # Pass #24 audit: confirmed landed via combined evidence (outputs + git-log evidence)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Module boundaries and layering fitness tests

Prevent architecture erosion by defining allowed dependencies and layer boundaries for bridge, web, protocol, tools, and config.

## Workflow-as-code control plane

```yaml
slice: wiring.module_boundaries_layering
priority: P0
area: architecture-fitness
owners:
  - architecture
  - bridge
  - web
depends_on:
  - wiring.enterprise_maturity_scorecard
sources:
  - apps/local-bridge/src
  - apps/web/src
  - packages
  - tools
  - docs/architecture/local-bridge-vil-style.md
outputs:
  - scripts/check-architecture-boundaries.mjs
  - apps/local-bridge/tests/architecture_boundaries.rs
steps:
  - id: step_01
    do: 'Define canonical layers for bridge, web, protocol, packages, tools, config, and docs.'
  - id: step_02
    do: 'Write dependency rules: transport cannot own product logic; UI cannot bypass domain/store layer for backend semantics; generated code cannot import app code.'
  - id: step_03
    do: 'Add architecture fitness tests to CI.'
  - id: step_04
    do: 'Document exceptions and require explicit owner.'
acceptance:
  - 'New product logic cannot be added to raw Axum route handlers.'
  - 'Web components use domain/action helpers instead of scattered transport semantics.'
  - 'Protocol packages remain app-agnostic.'
  - 'CI catches forbidden imports or module dependencies.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Target layers

```yaml
layers:
  bridge_transport:
    owns: [ws, server, auth glue]
    forbidden: [product workflows, release logic, connector business logic]
  bridge_process:
    owns: [session process, workflows, adapters, translator]
  bridge_runtime:
    owns: [ACP, fs, terminal, persistence, security]
  protocol:
    owns: [schemas, generated SDKs, samples]
  web_domain:
    owns: [event handlers, stores, queries]
  web_components:
    owns: [rendering and interaction only]
  tools:
    owns: [mock engines, codegen, parity checks]
```

## Why this matters

A declarative control-plane is only maintainable if runtime modules respect clear boundaries. Without fitness tests, hardcoded shortcuts will return quickly.
