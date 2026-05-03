---
id: wiring.adr_governance
title: 'Architecture decision records and governance'
priority: P1
area: architecture-governance
owners:
  - architecture
  - product
status: landed  # Pass #24 audit: confirmed landed (output paths all exist)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Architecture decision records and governance

Introduce lightweight ADR governance for decisions that affect runtime boundaries, command/event taxonomy, schemas, or security posture.

## Workflow-as-code control plane

```yaml
slice: wiring.adr_governance
priority: P1
area: architecture-governance
owners:
  - architecture
  - product
depends_on:
  - wiring.enterprise_maturity_scorecard
sources:
  - docs/architecture
  - docs/plans/wiring
  - CONTRIBUTING.md
outputs:
  - docs/adr/0000-template.md
  - docs/adr/
steps:
  - id: step_01
    do: 'Add ADR template with context, decision, alternatives, consequences, and migration plan.'
  - id: step_02
    do: 'Require ADR for new runtime subsystem, command family, public schema, or security boundary change.'
  - id: step_03
    do: 'Link ADRs from plan slices and durable docs.'
  - id: step_04
    do: 'Add docs check that ADR references are valid.'
acceptance:
  - 'Major architecture changes have ADRs.'
  - 'Plans reference ADRs when they alter boundaries.'
  - 'Historical rationale is preserved without stale phase plans.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## ADR trigger list

Create an ADR when a change introduces:

- a new backend executor class;
- a new command/event namespace;
- a new persisted data model;
- a new connector/auth boundary;
- a new workflow provisioning model;
- a new generated-code pipeline;
- a security or profile-core policy change.

ADR files should stay short and decision-oriented. Plans stay actionable; ADRs preserve rationale.
