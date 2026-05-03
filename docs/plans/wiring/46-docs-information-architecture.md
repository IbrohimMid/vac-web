---
id: wiring.docs_information_architecture
title: 'Documentation information architecture'
priority: P1
area: docs-dx
owners:
  - docs
  - product
  - architecture
status: landed  # Pass #24 audit: confirmed landed (output paths all exist)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Documentation information architecture

Make documentation durable, role-based, searchable, and separate from transient implementation notes.

## Workflow-as-code control plane

```yaml
slice: wiring.docs_information_architecture
priority: P1
area: docs-dx
owners:
  - docs
  - product
  - architecture
depends_on:
  - wiring.enterprise_maturity_scorecard
sources:
  - docs/README.md
  - docs/plans
  - docs/architecture
  - docs/product-specs
  - CONTRIBUTING.md
outputs:
  - docs/docs-governance.md
steps:
  - id: step_01
    do: 'Define docs taxonomy: product, architecture, protocol, operations, plans, ADRs.'
  - id: step_02
    do: 'Add freshness rules and stale-doc deletion criteria.'
  - id: step_03
    do: 'Add role-based reading paths and doc ownership.'
  - id: step_04
    do: 'Add docs link/stale-reference checks to CI.'
acceptance:
  - 'Docs have clear home and owner.'
  - 'Plans do not become stale historical phase logs.'
  - 'Role-based reading paths stay current.'
  - 'Broken links and stale refs fail checks.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Docs taxonomy

```yaml
docs:
  durable:
    - product-prd
    - architecture
    - protocol
    - security
    - operations
  plans:
    - active implementation slices only
  adr:
    - long-lived decisions and rationale
  generated:
    - inventories and codegen outputs
```

This prevents the repo from accumulating misleading stage docs again.
