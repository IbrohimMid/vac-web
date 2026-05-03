---
id: wiring.runtime_jobs
title: 'Runtime job model and cancellation'
priority: P2
area: runtime
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/stores/runtime.ts', 'apps/web/src/stores/runtime.test.ts']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Runtime job model and cancellation

Distinguish observed provider jobs from bridge-owned cancellable jobs.

## Workflow-as-code control plane

```yaml
slice: wiring.runtime_jobs
priority: P2
area: runtime
owners:
  - bridge
  - web
depends_on:
  - wiring.shell_terminal_boundary
sources:
  - apps/local-bridge/src/workflows/adapters.rs
  - apps/local-bridge/src/session/handle.rs
  - apps/web/src/domain/runtime
  - apps/web/src/components/Runtime
backend_surface:
  - runtime.job_log
  - runtime.list_jobs
  - runtime.inspect_job
  - runtime.cancel_job
  - runtime.jobs_updated
frontend_surface:
  - RuntimeTab
  - tool activity views
steps:
  - id: step_01
    do: 'Define job class: observed_provider vs bridge_owned.'
  - id: step_02
    do: 'Only bridge_owned jobs are cancellable.'
  - id: step_03
    do: 'Return runtime.job_not_cancellable for provider-observed jobs.'
  - id: step_04
    do: 'Wire runtime.jobs_updated if a bridge job registry exists.'
acceptance:
  - 'Cancel button only appears for cancellable jobs.'
  - 'Observed provider commands are labeled observed-only.'
  - 'Cancel result updates RuntimeTab without fake success.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
