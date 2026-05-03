---
id: wiring.config_capabilities_control_plane
title: 'Declarative config and capability control plane'
priority: P0
area: config-control-plane
owners:
  - bridge
  - web
  - protocol
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Declarative config and capability control plane

Adopt VIL-inspired workflow-as-code patterns for declarative YAML control-plane without moving runtime truth out of Rust/TS.

## Workflow-as-code control plane

```yaml
slice: wiring.config_capabilities_control_plane
priority: P0
area: config-control-plane
owners:
  - bridge
  - web
  - protocol
depends_on:
  - wiring.command_manifest
  - wiring.protocol_schema_parity
sources:
  - config
  - schema
  - apps/local-bridge/src/config
  - apps/local-bridge/src/capabilities.rs
  - docs/agent-runtime.md
backend_surface:
  - system.capabilities
  - config.validate
  - config.reload
  - agents.registry
  - mcp.servers
frontend_surface:
  - capability-aware controls
  - registry/config UI
steps:
  - id: step_01
    do: 'Define YAML schemas for workflow/control metadata.'
  - id: step_02
    do: 'Validate YAML before runtime mutation.'
  - id: step_03
    do: 'Generate capability manifest from Rust implementation, not YAML alone.'
  - id: step_04
    do: 'Use YAML for declarative desired state and Rust for side-effect execution.'
acceptance:
  - 'YAML cannot grant capability beyond bridge policy.'
  - 'Config reload validates before applying.'
  - 'UI affordances derive from current bridge capabilities.'
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

Workflow-as-code is best practice here for orchestration metadata and reviewability, not for bypassing runtime enforcement. Keep the YAML Pythonic: small maps/lists, obvious names, little ceremony, easy for agents to edit.
