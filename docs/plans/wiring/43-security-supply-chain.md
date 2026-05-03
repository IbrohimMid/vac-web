---
id: wiring.security_supply_chain
title: 'Security and supply-chain maturity'
priority: P0
area: security
owners:
  - security
  - bridge
  - web
status: landed  # Pass #23 audit: confirmed landed (frontmatter was stale)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Security and supply-chain maturity

Extend security maturity beyond profile enforcement into dependencies, secrets, generated code, CI, and release hygiene.

## Workflow-as-code control plane

```yaml
slice: wiring.security_supply_chain
priority: P0
area: security
owners:
  - security
  - bridge
  - web
depends_on:
  - wiring.profile_policy
  - wiring.auth_ws_security
sources:
  - SECURITY.md
  - deny.toml
  - .github/workflows/security.yml
  - Cargo.lock
  - pnpm-lock.yaml
  - packages/profile-core
  - apps/local-bridge/src/auth
outputs:
  - docs/security-architecture.md
  - schema/security-controls.yaml
steps:
  - id: step_01
    do: 'Inventory current cargo/npm security gates.'
  - id: step_02
    do: 'Define secret-handling and redaction controls for logs, persistence, and docs.'
  - id: step_03
    do: 'Define dependency approval/update policy.'
  - id: step_04
    do: 'Add generated-code provenance checks.'
  - id: step_05
    do: 'Map high-risk commands to required security controls.'
acceptance:
  - 'No new executor bypasses profile-core policy.'
  - 'Secrets are redacted in persistence/logs/notify lanes.'
  - 'Dependency/security gates are documented and enforced.'
  - 'Release/destructive controls require audit and gate policy.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Control groups

```yaml
controls:
  secrets:
    redaction: required
    persistence: redacted_before_write
  dependencies:
    cargo_deny: required
    npm_audit: evaluated
  generated_code:
    provenance: schema_or_catalog
    drift_check: required
  high_risk_commands:
    require_profile_policy: true
    require_audit: true
```
