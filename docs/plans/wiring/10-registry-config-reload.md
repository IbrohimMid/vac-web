---
id: wiring.registry_config_reload
title: 'Registry reload and config validation UX'
priority: P1
area: config-registry
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/config']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Registry reload and config validation UX

Make config reload refresh registry, capabilities, workflows, policy, and command gating.

## Workflow-as-code control plane

```yaml
slice: wiring.registry_config_reload
priority: P1
area: config-registry
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/config
  - apps/local-bridge/src/translator/mod.rs
  - apps/web/src/components/SessionPicker/RegistryBrowser.tsx
  - apps/web/src/domain/sessions/history.ts
backend_surface:
  - registry.sync
  - registry.add
  - registry.reloaded
  - config.validate
  - config.reload
  - config.reload.started
  - config.reloaded
  - config.validate.failed
  - config.validated
  - config.policy.get
frontend_surface:
  - RegistryBrowser
  - settings/session history surfaces
  - command capability store
steps:
  - id: step_01
    do: 'Wire registry.reloaded listener.'
  - id: step_02
    do: 'Refresh command manifest after config.reloaded.'
  - id: step_03
    do: 'Refresh registry/workflows/profile policy caches after config reload.'
  - id: step_04
    do: 'Render validation errors with file/path context.'
acceptance:
  - 'After reload, enabled controls reflect new capability state.'
  - 'User can distinguish validation failure from reload failure.'
  - 'No stale agent registry after successful reload.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
