---
id: wiring.release
title: 'Release event contract and safe deploy boundaries'
priority: P2
area: release
owners:
  - bridge
  - web
status: landed  # Pass #24 audit: confirmed landed via combined evidence (outputs + git-log evidence); Pass #27 deep audit: P14 acceptance verified — release.deploy/publish NotWired+External (command_catalog.rs:131-134); ReleaseTab gates canDeploy via gateReady+affordance; release.notes_draft labeled draft_only, deploy_progress+post_deploy_observation labeled mock_only (releaseEvents.ts:43-55, tests at releaseEvents.test.ts:17-22); 2026-05-06 R2 closeout: classification field added to 4 release.* events in config/control-plane/event-catalog.yaml (mirrored from releaseEvents.ts); regenerated event_catalog.rs + eventCatalog.ts; verify-codegen drift gate green
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Release event contract and safe deploy boundaries

Classify release targets, notes, deploy, publish, and post-deploy events before enabling production actions.

## Workflow-as-code control plane

```yaml
slice: wiring.release
priority: P2
area: release
owners:
  - bridge
  - web
depends_on:
  - wiring.gates_governance
  - wiring.connectors
sources:
  - docs/product-specs/release.md
  - apps/web/src/components/Release
  - apps/web/src/domain/release
  - tools/mock-engine/src/scenarios.rs
backend_surface:
  - release.list_targets
  - release.generate_notes
  - release.deploy
  - release.publish
  - release.targets
  - release.notes_draft
  - release.deploy_progress
  - release.post_deploy_observation
frontend_surface:
  - ReleaseTab
  - release store
steps:
  - id: step_01
    do: 'Classify release events as implemented, draft_only, mock_only, or future.'
  - id: step_02
    do: 'Implement list_targets read-only from local config first.'
  - id: step_03
    do: 'Keep notes draft-only until persistence exists.'
  - id: step_04
    do: 'Keep deploy/publish disabled until gates and audit are real.'
acceptance:
  - 'Release tab never implies production confidence from mock data.'
  - 'Deploy/publish disabled until gate readiness and backend executor exist.'
  - 'Draft notes are labeled drafts.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
