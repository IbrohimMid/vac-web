---
id: wiring.codegen_sdk_drift
title: 'Codegen and SDK drift checks'
priority: P0
area: codegen
owners:
  - protocol
  - tools
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Codegen and SDK drift checks

Add checks that generated protocol SDKs are in sync with schemas and command/event classification.

## Workflow-as-code control plane

```yaml
slice: wiring.codegen_sdk_drift
priority: P0
area: codegen
owners:
  - protocol
  - tools
depends_on:
  - wiring.protocol_schema_parity
sources:
  - tools/codegen
  - packages/protocol
  - packages/protocol-ts
  - packages/protocol-rs
backend_surface:
  - Command.ts
  - Event.ts
  - command.schema.json
  - event.schema.json
steps:
  - id: step_01
    do: 'Run codegen in CI and fail on diff.'
  - id: step_02
    do: 'Validate discriminant tests cover every schema command/event.'
  - id: step_03
    do: 'Export command/event inventory for manifest tests.'
  - id: step_04
    do: 'Document regeneration command in README.'
acceptance:
  - 'Generated files never drift from schema.'
  - 'New schema discriminant requires classification.'
  - 'Codegen output can be regenerated deterministically.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
