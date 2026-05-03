---
id: wiring.notify_overlay
title: 'Notify lane, overlays, and operator attention model'
priority: P2
area: notification-ux
owners:
  - web
  - bridge
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/domain/capabilities/notifyAttention.test.ts', 'apps/web/src/components/NotifyLane/NotifyLanes.tsx']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Notify lane, overlays, and operator attention model

Classify notify.event, overlay events, sticky alerts, and inline errors across all wiring slices.

## Workflow-as-code control plane

```yaml
slice: wiring.notify_overlay
priority: P2
area: notification-ux
owners:
  - web
  - bridge
depends_on:
  - wiring.overlay_workbench_plan
sources:
  - apps/local-bridge/src/notify.rs
  - apps/local-bridge/src/notify
  - apps/web/src/domain/notify
  - apps/web/src/overlays
  - docs/ux-grammar.md
backend_surface:
  - notify.event
  - overlay.opened
  - overlay.dismissed
  - overlay.open
  - overlay.dismiss
  - overlay.dismiss_all
frontend_surface:
  - Notify lane
  - OverlayHost
steps:
  - id: step_01
    do: 'Define when failures are inline vs sticky notification vs overlay.'
  - id: step_02
    do: 'Keep overlay commands frontend-owned unless cross-client persistence is added.'
  - id: step_03
    do: 'Map feature.not_wired to low-noise inline/tooltip copy.'
  - id: step_04
    do: 'Map destructive/failure states to sticky lane only when action is required.'
acceptance:
  - 'No domain uses alert/toast ad hoc.'
  - 'Operator attention level follows ux-grammar.'
  - 'Not-wired copy does not spam notification lane.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
