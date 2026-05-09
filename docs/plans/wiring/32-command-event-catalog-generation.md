---
id: wiring.command_event_catalog_generation
title: 'Command and event catalog generation'
priority: P0
area: codegen-control-plane
owners:
  - bridge
  - web
  - protocol
status: landed  # Pass #24 audit: confirmed landed via combined evidence (outputs + git-log evidence)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Command and event catalog generation

Replace scattered string catalogs with a declarative catalog plus generated Rust/TypeScript bindings and drift checks.

## Workflow-as-code control plane

```yaml
slice: wiring.command_event_catalog_generation
priority: P0
area: codegen-control-plane
owners:
  - bridge
  - web
  - protocol
depends_on:
  - wiring.declarative_pattern_adoption_audit
  - wiring.command_manifest
  - wiring.protocol_schema_parity
sources:
  - packages/protocol/v1/command.schema.json
  - packages/protocol/v1/event.schema.json
  - apps/local-bridge/src/profile_layer/mod.rs
  - apps/local-bridge/src/translator/mod.rs
  - apps/web/src/domain
outputs:
  - apps/local-bridge/src/generated/command_catalog.rs
  - apps/web/src/generated/commandCatalog.ts
  - apps/web/src/generated/eventCatalog.ts
  - docs/plans/wiring/generated-command-event-inventory.md
steps:
  - id: step_01
    do: 'Create declarative command catalog YAML that classifies every protocol and bridge command.'
  - id: step_02
    do: 'Generate Rust constants and TypeScript unions from the catalog.'
  - id: step_03
    do: 'Replace profile_layer::KNOWN_COMMANDS with generated constants.'
  - id: step_04
    do: 'Add parity tests: schema commands, catalog commands, bridge handlers, frontend senders.'
  - id: step_05
    do: 'Add event taxonomy catalog and parity tests for backend emitters and frontend listeners.'
acceptance:
  - 'No command string is accepted by profile_layer unless present in generated catalog.'
  - 'Every frontend command sender references generated command IDs or typed helper functions.'
  - 'Every backend event emitter and frontend listener is classified.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Proposed catalog shape

```yaml
commands:
  - id: session.mode.set
    owner: bridge
    status: implemented
    scope: session
    backend_handler: translator.session_mode_set
    frontend_surfaces:
      - Topbar.ModelContextChip
    requires:
      runtime_kind: acp
    errors:
      - session.not_found
      - session.not_acp
      - session.mode_id_required
      - session.mode_set_failed

  - id: release.deploy
    owner: bridge
    status: not_wired
    scope: workspace
    ui:
      gate: disabled
      reason: Release deploy backend is not implemented yet.
    requires:
      gate: ready_to_deploy
      audit: required
```

```yaml
events:
  - id: session.context.updated
    owner: bridge
    status: implemented
    producer: session.handle.prompt_response_usage
    consumers:
      - domain.sessions.handlers
      - Topbar.ModelContextChip

  - id: changeset.updated
    owner: mock
    status: legacy_mock_only
    replacement: review.changeset_updated
```

## Source migration rules

- Runtime match arms can stay in Rust, but command IDs should come from generated constants.
- UI should not spell command IDs inline except in tests that intentionally assert wire protocol.
- `profile_layer::KNOWN_COMMANDS` must become generated or verified against generated catalog.
- `feature.not_wired` fallback must use the same generated catalog.
- Mock-engine must use canonical event IDs from generated catalog.
