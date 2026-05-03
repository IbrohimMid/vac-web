---
id: wiring.enterprise_maturity_scorecard
title: 'Enterprise maturity scorecard'
priority: P0
area: architecture-governance
owners:
  - architecture
  - bridge
  - web
  - security
status: landed  # Pass #25b audit: confirmed via artifacts ['docs/enterprise-maturity-scorecard.md']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Enterprise maturity scorecard

Define the maturity bar for calling the repo mature, clean, enterprise-grade, and maintainable.

## Workflow-as-code control plane

```yaml
slice: wiring.enterprise_maturity_scorecard
priority: P0
area: architecture-governance
owners:
  - architecture
  - bridge
  - web
  - security
depends_on:
  - wiring.declarative_pattern_adoption_audit
sources:
  - docs/plans/wiring
  - docs/architecture
  - apps/local-bridge/src
  - apps/web/src
  - packages
  - tools
  - .github
outputs:
  - docs/plans/wiring/maturity-scorecard.generated.md
steps:
  - id: step_01
    do: 'Create repo-wide maturity scorecard across architecture, DX, tests, security, observability, data contracts, and docs.'
  - id: step_02
    do: 'Map each scorecard category to one or more plan slices.'
  - id: step_03
    do: 'Add a living status table that distinguishes planned, partial, implemented, and verified.'
  - id: step_04
    do: 'Require maturity scorecard update when new product surface is introduced.'
acceptance:
  - 'Every enterprise-grade claim maps to a measurable criterion.'
  - 'Scorecard exposes remaining architecture debt without hiding it behind wiring tasks.'
  - 'New plans must identify which maturity category they improve.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Maturity dimensions

| Dimension | Enterprise-grade bar |
|---|---|
| Architecture | Clear module boundaries, no raw business logic in transport, architecture fitness tests. |
| Control plane | Declarative YAML catalogs for command/event/workflow/affordance intent; generated bindings prevent drift. |
| Runtime | Rust/TS owns side effects, auth, fs, terminal, persistence, ACP, and policy. |
| DX | One-command checks, scaffolding, typed helpers, deterministic generation, low cognitive overhead. |
| Security | Profile-core policy, dependency governance, red-team tests, secret redaction, audit trails. |
| Observability | Structured events, errors, audit logs, degraded-state visibility, operator-facing recovery paths. |
| Testing | Unit/integration/contract/e2e/red-team/perf gates are explicit and fast enough for daily work. |
| Data/versioning | Versioned schemas, migrations, replay compatibility, generated SDK parity. |
| Documentation | Docs are role-based, current, searchable, and linked to implementation slices.

## Rule

After the current split plan set is implemented, the repo is much closer to the desired pattern. It is not fully enterprise-grade until this scorecard is green and enforced by CI/fitness tests.
