---
id: wiring.overlay_workbench_plan
title: 'Overlay, workbench, and plan ownership'
priority: P2
area: ui-command-ownership
owners:
  - web
  - bridge
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/stores/workbench.ts', 'apps/web/src/stores/workbench.test.ts']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Overlay, workbench, and plan ownership

Classify UI-only commands and provider-observed plan events so state ownership is explicit.

## Workflow-as-code control plane

```yaml
slice: wiring.overlay_workbench_plan
priority: P2
area: ui-command-ownership
owners:
  - web
  - bridge
depends_on:
  - wiring.command_manifest
sources:
  - apps/web/src/overlays
  - apps/web/src/app
  - apps/web/src/domain/agentSession
  - apps/local-bridge/src/profile_layer/mod.rs
backend_surface:
  - overlay.open
  - overlay.dismiss
  - overlay.dismiss_all
  - workbench.select_tab
  - workbench.invoke
  - plan.open
  - plan.edit
  - plan.approve
  - plan.reject
  - plan.updated
frontend_surface:
  - OverlayHost
  - workbench routes
  - AgentThread plan rendering
steps:
  - id: step_01
    do: 'Mark overlay.* and workbench.select_tab frontend_owned unless persistence is required.'
  - id: step_02
    do: 'Keep workbench.invoke not_wired unless mapped to concrete command.'
  - id: step_03
    do: 'Treat provider plan.updated as read-only until bridge plan state exists.'
  - id: step_04
    do: 'Do not let overlay/tab state cross WebSocket by default.'
acceptance:
  - 'Frontend-owned commands do not cross bridge.'
  - 'Plan mutation controls are hidden or disabled unless bridge owns plan state.'
  - 'No generic workbench backend escape hatch.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
