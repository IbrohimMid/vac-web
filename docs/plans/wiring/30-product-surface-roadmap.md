---
id: wiring.product_surface_roadmap
title: 'Product surface implementation roadmap'
priority: P0
area: roadmap
owners:
  - product
  - bridge
  - web
status: landed  # Pass #25b audit: confirmed via artifacts ['docs/architecture.md', 'docs/architecture']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Product surface implementation roadmap

Order all split plans into implementation waves that reduce misleading UX before adding product breadth.

## Workflow-as-code control plane

```yaml
slice: wiring.product_surface_roadmap
priority: P0
area: roadmap
owners:
  - product
  - bridge
  - web
depends_on:
  - wiring.index
sources:
  - docs/plans/wiring
  - apps/local-bridge/src
  - apps/web/src
steps:
  - id: step_01
    do: 'Wave -4: final coverage closure for fixtures/scripts/repo hygiene and web rendering pipeline.
  - Wave -3: external benchmark alignment: spec/status, reconcile, conditions, admission/defaulting, dry-run/diff, version conversion, golden examples, provenance.
  - Wave -2: enterprise maturity foundation: scorecard, module boundaries, ADRs, DX tooling, error taxonomy, testing, security, data/versioning, generated-code ownership, docs governance.
  - Wave -1: declarative pattern adoption audit and command/event catalog generation.
  - Wave 0: manifest, not-wired fallback, protocol/codegen parity.'
  - id: step_02
    do: 'Wave 1: session model/context, config reload, review taxonomy, approval/handoff errors.'
  - id: step_03
    do: 'Wave 2: shell, session rename/history, assessment index, workflow engine.'
  - id: step_04
    do: 'Wave 3: connectors, gates, release, runtime jobs.'
  - id: step_05
    do: 'Wave 4: migration/continuous, overlay/workbench/plan ownership cleanup.'
acceptance:
  - 'Implementation order first removes false affordances.'
  - 'High-risk/destructive surfaces remain disabled until bridge executors and policy are real.'
  - 'Each wave has clear UX impact and validation gates.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
