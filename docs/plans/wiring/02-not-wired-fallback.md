---
id: wiring.not_wired_fallback
title: 'Structured not-wired fallback'
priority: P0
area: bridge
owners:
  - bridge
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Structured not-wired fallback

Return deterministic feature.not_wired for declared but unimplemented commands instead of forwarding them to provider sessions.

## Workflow-as-code control plane

```yaml
slice: wiring.not_wired_fallback
priority: P0
area: bridge
owners:
  - bridge
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/translator/mod.rs
  - apps/local-bridge/src/profile_layer/mod.rs
  - apps/local-bridge/src/session/handle.rs
backend_surface:
  - feature.not_wired
  - agent.protocol_unsupported
steps:
  - id: step_01
    do: 'Build a command classification lookup from the manifest.'
  - id: step_02
    do: 'Before session/agent fallback, intercept not_wired commands.'
  - id: step_03
    do: 'Return ok=false with code feature.not_wired and operator-facing message.'
  - id: step_04
    do: 'Log classification for audit without treating it as policy denial.'
acceptance:
  - 'Known-but-unimplemented commands never reach ACP provider fallback.'
  - 'External/stale clients receive stable error code.'
  - 'Web toasts can show the feature area and reason.'
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

- No-op success would be worse than failure; never return ok=true for not_wired.
