---
id: wiring.command_manifest
title: 'Command implementation manifest'
priority: P0
area: control-plane
owners:
  - bridge
  - web
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Command implementation manifest

Expose a bridge-owned manifest that classifies every command in profile_layer::KNOWN_COMMANDS.

## Workflow-as-code control plane

```yaml
slice: wiring.command_manifest
priority: P0
area: control-plane
owners:
  - bridge
  - web
depends_on:
  - none
sources:
  - apps/local-bridge/src/profile_layer/mod.rs
  - apps/local-bridge/src/translator/mod.rs
  - apps/local-bridge/src/session/handle.rs
  - apps/web/src/domain
  - apps/web/src/components
backend_surface:
  - system.capabilities
  - profile_layer::KNOWN_COMMANDS
frontend_surface:
  - command palette
  - visible cockpit controls
  - domain command senders
steps:
  - id: step_01
    do: 'Extract real implemented command arms from translator/session.'
  - id: step_02
    do: 'Classify every KNOWN_COMMANDS entry as implemented, not_wired, frontend_owned, protocol_only, internal, or deprecated.'
  - id: step_03
    do: 'Expose classification through system.capabilities.'
  - id: step_04
    do: 'Add manifest regression test that fails on unclassified command.'
acceptance:
  - 'No command in KNOWN_COMMANDS is unclassified.'
  - 'UI gates controls from manifest status.'
  - 'Catalog-only commands are not shown as executable.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.

## Risks

- If frontend treats KNOWN_COMMANDS as implemented, stale clients can route zombie commands into ACP fallback.
