---
id: wiring.generated_code_ownership
title: 'Generated code ownership and edit policy'
priority: P0
area: codegen
owners:
  - protocol
  - tools
  - dx
status: landed  # Pass #24 audit: confirmed landed (output paths all exist)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Generated code ownership and edit policy

Make generated files obvious, immutable by hand, and traceable to schemas/catalogs.

## Workflow-as-code control plane

```yaml
slice: wiring.generated_code_ownership
priority: P0
area: codegen
owners:
  - protocol
  - tools
  - dx
depends_on:
  - wiring.codegen_sdk_drift
sources:
  - packages/protocol-ts/src/v1/generated
  - packages/protocol-rs/src/v1/generated
  - tools/codegen
  - docs/plans/wiring/32-command-event-catalog-generation.md
outputs:
  - docs/generated-code.md
  - tools/codegen/MANIFEST.json
steps:
  - id: step_01
    do: 'Create generated-code manifest listing source schema/catalog and output files.'
  - id: step_02
    do: 'Add headers to generated files warning not to edit by hand.'
  - id: step_03
    do: 'Add CI check that generated files match source.'
  - id: step_04
    do: 'Document regeneration commands.'
acceptance:
  - 'Generated files have owners and source-of-truth pointers.'
  - 'Manual edits to generated output are caught by CI.'
  - 'Agents know whether to edit schema/catalog or generated file.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Ownership rule

```yaml
generated_file_policy:
  edit_generated_directly: forbidden
  source_of_truth:
    - packages/protocol/v1/*.schema.json
    - docs/plans/wiring/catalogs/*.yaml
  ci: fail_on_generated_diff
```

This reduces cognitive load and prevents stale SDKs.
