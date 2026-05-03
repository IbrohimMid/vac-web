---
id: wiring.ci_validation_gates
title: 'CI validation gates for wiring slices'
priority: P0
area: ci
owners:
  - bridge
  - web
  - protocol
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# CI validation gates for wiring slices

Define minimal gates for every wiring slice, including docs link checks and manifest/schema parity.

## Workflow-as-code control plane

```yaml
slice: wiring.ci_validation_gates
priority: P0
area: ci
owners:
  - bridge
  - web
  - protocol
depends_on:
  - wiring.protocol_schema_parity
  - wiring.command_manifest
sources:
  - package.json
  - Cargo.toml
  - scripts
  - .github
  - docs/plans
backend_surface:
  - cargo check -p local-bridge
  - cargo test -p local-bridge --lib
frontend_surface:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
steps:
  - id: step_01
    do: 'Keep standard web/Rust gates.'
  - id: step_02
    do: 'Add command manifest parity test.'
  - id: step_03
    do: 'Add protocol/codegen drift test.'
  - id: step_04
    do: 'Add docs local link check for plan split.'
  - id: step_05
    do: 'Add mock-engine parity check.'
acceptance:
  - 'No slice lands without focused tests and broad gates.'
  - 'Docs split has no broken links.'
  - 'Command/event drift fails fast.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
