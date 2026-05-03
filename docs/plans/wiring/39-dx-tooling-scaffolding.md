---
id: wiring.dx_tooling_scaffolding
title: 'DX tooling and scaffolding'
priority: P0
area: developer-experience
owners:
  - dx
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['package.json']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# DX tooling and scaffolding

Make the repo dramatically easier for agents/executors and humans to extend safely with scaffolds, generators, and one-command checks.

## Workflow-as-code control plane

```yaml
slice: wiring.dx_tooling_scaffolding
priority: P0
area: developer-experience
owners:
  - dx
  - bridge
  - web
depends_on:
  - wiring.command_event_catalog_generation
  - wiring.module_boundaries_layering
sources:
  - package.json
  - Cargo.toml
  - scripts
  - tools/codegen
  - docs/plans/wiring
outputs:
  - scripts/vac-plan-new.mjs
  - scripts/vac-command-new.mjs
  - scripts/vac-event-new.mjs
  - scripts/vac-check-all.mjs
steps:
  - id: step_01
    do: 'Add one command to run all standard checks with clear grouping.'
  - id: step_02
    do: 'Add scaffolds for new command, event, workflow, web affordance, and plan slice.'
  - id: step_03
    do: 'Make scaffolds create YAML catalog entry, Rust/TS stubs, tests, and docs links.'
  - id: step_04
    do: 'Add generated TODO checklist in PR body.'
acceptance:
  - 'New command/event work starts from a scaffold, not copy-paste.'
  - 'Agent can implement a slice by following generated files and YAML acceptance gates.'
  - 'Local check command reports failures with domain labels.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Desired DX

The executor experience should feel like Pythonic product coding:

```bash
pnpm vac:new command shell.start
pnpm vac:new event session.context.updated
pnpm vac:new workflow assess.index.rebuild
pnpm vac:check all
```

Scaffolds should create small, obvious files and avoid magic. They should energize contributors because the repo tells them where each piece belongs.
