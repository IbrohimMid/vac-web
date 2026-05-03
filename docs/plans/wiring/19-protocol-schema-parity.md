---
id: wiring.protocol_schema_parity
title: 'Protocol schema, generated SDK, and bridge parity'
priority: P0
area: protocol
owners:
  - protocol
  - bridge
  - web
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Protocol schema, generated SDK, and bridge parity

Ensure protocol schemas, generated TS/Rust types, bridge handlers, web handlers, and mock scenarios do not drift.

## Workflow-as-code control plane

```yaml
slice: wiring.protocol_schema_parity
priority: P0
area: protocol
owners:
  - protocol
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - packages/protocol/v1
  - packages/protocol-ts/src/v1/generated
  - packages/protocol-rs
  - tools/codegen
  - apps/local-bridge/src
  - apps/web/src
backend_surface:
  - packages/protocol/v1/command.schema.json
  - packages/protocol/v1/event.schema.json
frontend_surface:
  - protocol-ts generated types
  - web domain handlers
steps:
  - id: step_01
    do: 'Generate command/event inventory from protocol schemas.'
  - id: step_02
    do: 'Diff schema commands against KNOWN_COMMANDS and manifest.'
  - id: step_03
    do: 'Diff event schema against bridge emitters and web listeners.'
  - id: step_04
    do: 'Add CI check that generated TS/Rust output is current.'
acceptance:
  - 'No protocol command lacks manifest classification.'
  - 'Generated SDK matches schema.'
  - 'Mock-engine scenarios use canonical event names.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
