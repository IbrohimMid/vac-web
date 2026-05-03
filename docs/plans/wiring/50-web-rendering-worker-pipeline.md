---
id: wiring.web_rendering_worker_pipeline
title: 'Web rendering, markdown, highlight, transcript, and worker pipeline'
priority: P1
area: web-runtime-dx
owners:
  - web
  - dx
status: landed  # Pass #25b audit: confirmed via artifacts ['apps/web/vite.config.ts', 'apps/web/src']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Web rendering, markdown, highlight, transcript, and worker pipeline

Final coverage scan found several web runtime/support modules that were only implicitly covered by broader frontend plans: composer internals, markdown rendering, syntax highlighting, transcript freeze behavior, workers, main bootstrap, and Vite env types.

## Workflow-as-code control plane

```yaml
slice: wiring.web_rendering_worker_pipeline
priority: P1
area: web-runtime-dx
owners:
  - web
  - dx
depends_on:
  - wiring.frontend_declarative_affordances
  - wiring.testing_strategy_pyramid
  - wiring.module_boundaries_layering
sources:
  - apps/web/src/composer
  - apps/web/src/highlight
  - apps/web/src/markdown
  - apps/web/src/transcript
  - apps/web/src/workers
  - apps/web/src/main.tsx
  - apps/web/src/vite-env.d.ts
  - apps/web/src/scripts
outputs:
  - docs/web-rendering-pipeline.md
  - apps/web/src/generated/renderingPipelineCatalog.ts
  - scripts/check-web-rendering-pipeline.mjs
steps:
  - id: step_01
    do: 'Inventory rendering pipeline modules and classify them as bootstrap, parser, renderer, highlighter, worker, transcript, or test helper.'
  - id: step_02
    do: 'Define declarative rendering capability catalog for markdown features, code highlighting languages, worker boundaries, and transcript freeze modes.'
  - id: step_03
    do: 'Add tests for markdown/highlight/transcript behavior that are not tied to backend transport.'
  - id: step_04
    do: 'Add architecture rule: rendering pipeline modules may consume domain state but must not send bridge commands directly.'
acceptance:
  - 'Markdown/highlight/transcript modules have documented ownership and tests.'
  - 'Workers have explicit input/output contracts and do not access bridge transport directly.'
  - 'main.tsx remains bootstrap/composition only, not business logic.'
  - 'Rendering capabilities are declarative and testable without agent runtime.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Proposed rendering catalog

```yaml
rendering:
  markdown:
    owner: web
    source: apps/web/src/markdown
    features:
      - code_blocks
      - tables
      - links
      - safe_html_disabled
  highlight:
    owner: web
    source: apps/web/src/highlight
    worker: apps/web/src/workers/shiki.worker.ts
  transcript:
    owner: web
    source: apps/web/src/transcript
    modes:
      - live
      - frozen
      - replay
```

## Boundary rule

Rendering modules are frontend runtime support. They may render domain state and use workers, but they must not own product workflows, backend command dispatch, or bridge event semantics.
