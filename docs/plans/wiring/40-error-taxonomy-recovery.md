---
id: wiring.error_taxonomy_recovery
title: 'Error taxonomy and recovery UX'
priority: P0
area: error-handling
owners:
  - bridge
  - web
  - security
status: landed  # Pass #25 audit: confirmed via artifact paths ['schema/error-taxonomy.yaml', 'apps/local-bridge/src/generated/error_taxonomy_catalog.rs']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Error taxonomy and recovery UX

Unify backend error codes, UI recovery copy, retryability, severity, and audit semantics.

## Workflow-as-code control plane

```yaml
slice: wiring.error_taxonomy_recovery
priority: P0
area: error-handling
owners:
  - bridge
  - web
  - security
depends_on:
  - wiring.command_event_catalog_generation
sources:
  - apps/local-bridge/src/translator
  - apps/local-bridge/src/session
  - packages/bridge-core/src/error.rs
  - apps/web/src/domain
  - docs/ux-grammar.md
outputs:
  - schema/error-taxonomy.yaml
  - apps/web/src/generated/errorTaxonomyCatalog.ts
  - apps/local-bridge/src/generated/error_taxonomy_catalog.rs
steps:
  - id: step_01
    do: 'Inventory all error codes emitted by bridge and profile-core.'
  - id: step_02
    do: 'Define YAML error taxonomy with severity, retryability, user copy, audit class, and owner.'
  - id: step_03
    do: 'Generate Rust/TS constants and UI copy mapping.'
  - id: step_04
    do: 'Replace raw generic error handling where possible.'
acceptance:
  - 'Every backend error code has owner, severity, retryability, and UX destination.'
  - 'feature.not_wired, policy denial, auth failure, and provider unsupported are visually distinct.'
  - 'Errors have recovery guidance when actionable.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Proposed shape

```yaml
errors:
  - code: feature.not_wired
    severity: info
    retryable: false
    ux: inline_disabled_reason
    copy: This control is not wired to the local bridge yet.
  - code: profile.shell_bin_not_allowed
    severity: warning
    retryable: false
    ux: sticky_security_notice
    audit: required
```

Enterprise-grade UX needs predictable recovery, not raw protocol errors.
