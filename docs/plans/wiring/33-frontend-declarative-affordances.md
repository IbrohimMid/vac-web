---
id: wiring.frontend_declarative_affordances
title: 'Frontend declarative affordance catalog'
priority: P1
area: web-control-plane
owners:
  - web
  - bridge
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Frontend declarative affordance catalog

Move scattered UI command affordances toward a declarative catalog that maps UI controls to command capability status, required session state, provider runtime, and UX copy.

## Workflow-as-code control plane

```yaml
slice: wiring.frontend_declarative_affordances
priority: P1
area: web-control-plane
owners:
  - web
  - bridge
depends_on:
  - wiring.command_event_catalog_generation
  - wiring.command_manifest
sources:
  - apps/web/src/components
  - apps/web/src/actions
  - apps/web/src/domain
  - apps/web/src/stores
frontend_surface:
  - CommandPalette
  - SlashPalette
  - Topbar
  - ShellDrawer
  - ReleaseTab
  - ConnectorsTab
  - Gates
  - Review
  - RuntimeTab
steps:
  - id: step_01
    do: 'Inventory every transport.send call in components and domain helpers.'
  - id: step_02
    do: 'Move user-visible command affordance metadata into a declarative UI affordance catalog.'
  - id: step_03
    do: 'Generate typed helpers that bind affordance ID to command ID and capability gating.'
  - id: step_04
    do: 'Replace scattered disabled/reason logic with catalog-driven selectors.'
acceptance:
  - 'A visible enabled control always maps to implemented backend command or frontend_owned action.'
  - 'Disabled controls show consistent operator-facing reason copy.'
  - 'New command buttons require catalog entry and tests.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Proposed affordance shape

```yaml
affordances:
  - id: topbar.model.select
    component: Topbar.ModelContextChip
    command: session.mode.set
    when:
      session_kind: acp
      has_transport: true
      has_session_id: true
      metadata_any:
        - modes
        - models
    enabled_if:
      command_status: implemented
    disabled_copy: Model switching is unavailable for this runtime.

  - id: release.deploy.button
    component: ReleaseTab.DeployButton
    command: release.deploy
    enabled_if:
      command_status: implemented
      gate: ready_to_deploy
    disabled_copy: Release deploy backend is not wired yet.
```

## UX rule

A control should feel deterministic:

- visible + enabled = executable;
- visible + disabled = reason is obvious;
- hidden = not relevant to current mode/runtime;
- not-wired = low-noise inline copy, not scary error toast.
