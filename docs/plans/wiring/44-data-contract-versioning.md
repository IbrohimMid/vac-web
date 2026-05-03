---
id: wiring.data_contract_versioning
title: 'Data contracts, versioning, and migrations'
priority: P1
area: data-contracts
owners:
  - bridge
  - protocol
  - web
status: landed  # Pass #24 audit: confirmed landed (output paths all exist)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Data contracts, versioning, and migrations

Define versioning rules for persisted events, protocol schemas, workflow specs, config files, and replay compatibility.

## Workflow-as-code control plane

```yaml
slice: wiring.data_contract_versioning
priority: P1
area: data-contracts
owners:
  - bridge
  - protocol
  - web
depends_on:
  - wiring.persistence_replay_redaction
  - wiring.protocol_schema_parity
sources:
  - packages/protocol/v1
  - schema/config
  - apps/local-bridge/src/session/persistence
  - apps/local-bridge/src/storage
  - config
outputs:
  - docs/data-contract-versioning.md
  - schema/migrations/README.md
steps:
  - id: step_01
    do: 'Inventory persisted data shapes and config schemas.'
  - id: step_02
    do: 'Define versioning and migration rules for each persisted/configured shape.'
  - id: step_03
    do: 'Define replay compatibility policy.'
  - id: step_04
    do: 'Add tests for reading older persisted events/config versions.'
acceptance:
  - 'Persisted/replayed events remain compatible or explicitly migrated.'
  - 'Config schema changes have migration guidance.'
  - 'Protocol schema changes are versioned and generated SDKs updated.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Versioned surfaces

```yaml
versioned_surfaces:
  protocol_events: packages/protocol/v1/event.schema.json
  protocol_commands: packages/protocol/v1/command.schema.json
  session_persistence: apps/local-bridge/src/session/persistence
  assessment_storage: apps/local-bridge/src/storage
  config: schema/config
  workflows: apps/local-bridge/src/workflows/spec.rs
```

Mature architecture needs explicit compatibility rules before stored history becomes valuable.
