---
id: wiring.context_palette
title: 'Mention search, attachments, and palette invoke'
priority: P2
area: composer-palette
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/components']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Mention search, attachments, and palette invoke

Make @ mention and palette surfaces concrete, not generic backend escape hatches.

## Workflow-as-code control plane

```yaml
slice: wiring.context_palette
priority: P2
area: composer-palette
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/web/src/components/Composer
  - apps/web/src/actions
  - apps/local-bridge/src/profile_layer/mod.rs
backend_surface:
  - context.mention_search
  - context.mention_results
  - context.attach_files
  - palette.invoke_action
frontend_surface:
  - Composer
  - MentionPicker
  - CommandPalette
  - SlashPalette
steps:
  - id: step_01
    do: 'Back mention search with local project/session/assessment/handoff indexes.'
  - id: step_02
    do: 'Classify context.attach_files before enabling file attachment.'
  - id: step_03
    do: 'Make palette actions map to concrete commands or remain disabled.'
  - id: step_04
    do: 'Do not implement generic palette.invoke_action as arbitrary bridge executor.'
acceptance:
  - '@ mention returns real local entities.'
  - 'Attachments respect project-root/profile policy.'
  - 'Palette never invokes unclassified generic actions.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
