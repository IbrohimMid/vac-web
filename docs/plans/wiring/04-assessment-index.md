---
id: wiring.assessment_index
title: 'Assessment index lifecycle'
priority: P1
area: assessment
owners:
  - bridge
  - web
status: landed  # Pass #24 audit: confirmed landed via combined evidence (outputs + git-log evidence); Pass #27 deep audit: P04 acceptance verified — status/rebuild_started/progress/rebuilt/failed events emit with discriminant codes (assessment_query.rs); failure codes distinct (storage/schema/persistence_disabled via AssessmentIndexStatus enum); ReadinessHub consumes lifecycle
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Assessment index lifecycle

Wire assessment index status/rebuild events to readiness UX and expose stale/rebuild/failure state.

## Workflow-as-code control plane

```yaml
slice: wiring.assessment_index
priority: P1
area: assessment
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/translator/assessment_query.rs
  - apps/local-bridge/src/storage/assessment_index.rs
  - apps/web/src/domain/assessment
  - apps/web/src/components/Readiness
backend_surface:
  - assessment.index.status
  - assessment.index.rebuild
  - assessment.index.rebuild_started
  - assessment.index.rebuild_progress
  - assessment.index.rebuilt
  - assessment.index.rebuild_failed
  - assessment.index_status_failed
  - assessment.index_rebuild_failed
frontend_surface:
  - ReadinessHub
  - Assessment report detail
  - assessment store
steps:
  - id: step_01
    do: 'Add index status query in readiness surface.'
  - id: step_02
    do: 'Add rebuild control gated by manifest.'
  - id: step_03
    do: 'Render rebuild progress and failure without clearing existing findings.'
  - id: step_04
    do: 'Define cancelability or explicitly mark rebuild non-cancellable.'
acceptance:
  - 'User sees whether index is enabled, current, stale, rebuilding, or failed.'
  - 'Rebuild progress is visible.'
  - 'Failure reason distinguishes storage/schema/project-root/persistence-disabled.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
