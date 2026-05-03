---
id: wiring.session_model_context
title: 'Session model, mode, config, slash commands, and context telemetry'
priority: P0
area: session-acp
owners:
  - bridge
  - web
status: landed  # Pass #25b audit: confirmed via artifacts ['apps/local-bridge/src/session/handle.rs', 'apps/local-bridge/src/session/mod.rs']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Session model, mode, config, slash commands, and context telemetry

Lock the ACP model/mode/config/context pipeline as first-class cockpit wiring.

## Workflow-as-code control plane

```yaml
slice: wiring.session_model_context
priority: P0
area: session-acp
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/session/handle.rs
  - apps/local-bridge/src/translator/mod.rs
  - apps/web/src/components/cockpit/Topbar.tsx
  - apps/web/src/domain/sessions/handlers.ts
  - apps/web/src/components/Composer
backend_surface:
  - session.mode.set
  - session.config_option.set
  - session.mode.updated
  - session.config_options.updated
  - session.context.updated
  - session.available_commands.updated
frontend_surface:
  - Topbar model/context chip
  - Composer slash palette
  - session store
steps:
  - id: step_01
    do: 'Treat session.mode.set and session.config_option.set as implemented ACP-only bridge commands.'
  - id: step_02
    do: 'Preserve contextUsed on model switch and update denominator from selected model metadata.'
  - id: step_03
    do: 'Parse provider usage telemetry into session.context.updated.'
  - id: step_04
    do: 'Keep ACP slash commands separate from VAC command manifest.'
acceptance:
  - 'Switching 587k/1m to a 218k model renders 587k/218k until provider telemetry updates.'
  - 'Provider usage updates contextUsed/contextLimit.'
  - 'ACP slash command selection inserts slash text without invoking VAC transport command.'
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

- Resetting contextUsed on model switch lies about provider state and conflicts with CLI auto-compact behavior.
