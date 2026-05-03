---
id: wiring.review_taxonomy
title: 'Review event taxonomy and file actions'
priority: P0
area: review
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/stores/review.ts', 'apps/web/src/stores/review.test.ts']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Review event taxonomy and file actions

Canonicalize review events and implement or disable review open/revert controls.

## Workflow-as-code control plane

```yaml
slice: wiring.review_taxonomy
priority: P0
area: review
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/session/handle.rs
  - apps/local-bridge/src/workflows/adapters.rs
  - apps/web/src/domain/review/handlers.ts
  - apps/web/src/components/Review
backend_surface:
  - review.changeset_updated
  - review.open_file
  - review.revert_file
  - review.revert_all
  - review.toggle_hunk
frontend_surface:
  - ReviewTab
  - DiffViewer
  - review store
steps:
  - id: step_01
    do: 'Canonicalize bridge-owned review state on review.* events.'
  - id: step_02
    do: 'Remove or explicitly adapt legacy changeset.* listeners.'
  - id: step_03
    do: 'Classify review.toggle_hunk as frontend_owned or not_wired.'
  - id: step_04
    do: 'Implement file open/revert with project-root scope checks or disable them.'
acceptance:
  - 'Review store has one canonical event taxonomy.'
  - 'Tests use events emitted by local-bridge, not mock-only changeset.*.'
  - 'Destructive revert controls are disabled unless backend can safely restore content.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
