---
id: wiring.migration_continuous
title: 'Migration and continuous config hold'
priority: P3
area: migration-continuous
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['CHANGELOG.md']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Migration and continuous config hold

Keep migration and continuous write config disabled until persistence, rollback, and validation semantics exist.

## Workflow-as-code control plane

```yaml
slice: wiring.migration_continuous
priority: P3
area: migration-continuous
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
  - wiring.persistence_replay_redaction
sources:
  - apps/web/src/components/Migration
  - apps/web/src/stores/migration.ts
  - apps/web/src/components/GuidedMode
backend_surface:
  - migration.create_draft
  - migration.dry_run
  - migration.verify_reversibility
  - migration.dispatch
  - continuous.write_config
frontend_surface:
  - MigrationTab
  - GuidedMode
steps:
  - id: step_01
    do: 'Classify full migration family as not_wired.'
  - id: step_02
    do: 'Do not enable create_draft alone.'
  - id: step_03
    do: 'Define rollback/reversibility requirements before dispatch.'
  - id: step_04
    do: 'Keep continuous.write_config disabled until config schema validation and rollback exist.'
acceptance:
  - 'No migration action is partially enabled.'
  - 'UI explains why migration is held.'
  - 'No config write path can corrupt current runtime config.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
