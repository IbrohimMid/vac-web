---
id: wiring.workflow_engine
title: 'Workflow engine, adapters, and workflow-as-code registry'
priority: P1
area: workflows
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/workflows', 'apps/local-bridge/src/workflows/spec.rs']; Pass #26 deep audit: P18 acceptance verified — UI destinations + internal classification mapped in workflowEvents.ts (5 tests); Rust executor.rs is source of truth; YAML metadata-only (see wave-summary-2026-05-03.md)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Workflow engine, adapters, and workflow-as-code registry

Align workflow registry/adapters/events with VIL-inspired declarative control-plane while keeping execution in Rust.

## Workflow-as-code control plane

```yaml
slice: wiring.workflow_engine
priority: P1
area: workflows
owners:
  - bridge
  - web
depends_on:
  - wiring.config_capabilities_control_plane
  - wiring.protocol_schema_parity
sources:
  - apps/local-bridge/src/workflows
  - apps/web/src/domain/workflow
  - apps/web/src/stores/workflow.ts
  - config
  - schema
backend_surface:
  - workflow.started
  - workflow.step.started
  - workflow.step.updated
  - workflow.step.completed
  - workflow.step.failed
  - workflow.completed
  - workflow.failed
  - workflow.artifact.created
  - workflow.input.message_submit
frontend_surface:
  - workflow rail
  - workflow store
  - BuildSurface
steps:
  - id: step_01
    do: 'Document YAML workflow control-plane schema for registry entries.'
  - id: step_02
    do: 'Wire workflow.input.message_submit or classify it internal.'
  - id: step_03
    do: 'Map adapter-emitted runtime events to workflow UI.'
  - id: step_04
    do: 'Keep workflow execution, auth, fs, terminal, and persistence in Rust.'
acceptance:
  - 'Every workflow event has UI destination or internal classification.'
  - 'YAML controls orchestration metadata only.'
  - 'Rust executor remains source of truth for side effects.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.

## Notes

VIL-inspired means declarative workflow-as-code for control-plane metadata, not copying VIL runtime internals.
