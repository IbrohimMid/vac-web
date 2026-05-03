---
id: wiring.workflow_authoring_rules
title: 'Workflow authoring rules'
priority: P1
area: workflows
owners:
  - bridge
  - product
  - web
status: landed  # Pass #25b audit: confirmed via artifacts ['apps/local-bridge/src/workflows', 'docs/architecture']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Workflow authoring rules

Document the coding rule for new workflow/control-plane features: write the intent declaratively first, then implement the runtime handler in Rust/TypeScript.

## Workflow-as-code control plane

```yaml
slice: wiring.workflow_authoring_rules
priority: P1
area: workflows
owners:
  - bridge
  - product
  - web
depends_on:
  - wiring.workflow_engine
  - wiring.config_capabilities_control_plane
sources:
  - apps/local-bridge/src/workflows
  - config
  - schema
  - docs/architecture/local-bridge-vil-style.md
outputs:
  - docs/workflow-authoring.md
  - schema/workflow-control-plane.schema.json
  - examples/workflows/assess-index-rebuild.yaml
  - scripts/check-workflow-authoring.mjs
steps:
  - id: step_01
    do: 'For every new product flow, create a YAML control-plane sketch before runtime code.'
  - id: step_02
    do: 'Keep YAML bundled/allowlisted unless a future secure provisioning design exists.'
  - id: step_03
    do: 'Implement side effects in Rust workflow executor/adapters, not raw Axum routes.'
  - id: step_04
    do: 'Add web UI affordance mapping after backend events/commands are classified.'
acceptance:
  - 'New product features do not start as raw route handlers.'
  - 'Each workflow has a declarative spec, runtime handler, UI consumer, and tests.'
  - 'Agents can implement feature slices from readable YAML without guessing state transitions.'
  - 'Workflow authoring template exists and is schema-validated before runtime code is added.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Coding rule

1. Write declarative YAML first:

```yaml
workflow: assess.index.rebuild
states:
  - idle
  - rebuilding
  - completed
  - failed
events:
  - assessment.index.rebuild_started
  - assessment.index.rebuild_progress
  - assessment.index.rebuilt
  - assessment.index.rebuild_failed
ui:
  surface: ReadinessHub
  progress: visible
  failure: inline_and_notify
```

2. Implement runtime authority in Rust.
3. Bind UI with generated command/event constants.
4. Add tests for YAML schema, runtime behavior, and UI rendering.

## Agent DX goal

The YAML should make the agent/executor feel like it is coding Python: small obvious structures, explicit names, no hidden framework ceremony, and fast mechanical translation into code. This is a DX optimization and a safety mechanism.
