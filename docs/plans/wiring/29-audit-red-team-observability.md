---
id: wiring.audit_observability
title: 'Audit trail, red-team cases, and observability'
priority: P1
area: audit-observability
owners:
  - bridge
  - security
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['tests/red-team', 'apps/local-bridge/src/observability.rs']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Audit trail, red-team cases, and observability

Ensure wiring changes add audit, red-team, and observability coverage for side effects and trust boundaries.

## Workflow-as-code control plane

```yaml
slice: wiring.audit_observability
priority: P1
area: audit-observability
owners:
  - bridge
  - security
  - web
depends_on:
  - wiring.profile_policy
  - wiring.persistence_replay_redaction
sources:
  - apps/local-bridge/src/audit
  - packages/bridge-core/src/audit.rs
  - docs/red-team-test-plan.md
  - docs/capability-profiles.md
  - apps/web/src/domain/notify
backend_surface:
  - audit.write_failed
  - notify.event
  - profile.*
  - feature.not_wired
frontend_surface:
  - notify lane
  - security/error banners
steps:
  - id: step_01
    do: 'Log side-effect command attempts, denials, and not-wired responses.'
  - id: step_02
    do: 'Add red-team cases for new executors before enabling UI.'
  - id: step_03
    do: 'Surface audit.write_failed as degraded observability.'
  - id: step_04
    do: 'Ensure secret redaction covers logs, persistence, and notifications.'
acceptance:
  - 'Destructive actions have audit trail.'
  - 'Policy denials and not-wired errors are distinguishable.'
  - 'Red-team test plan is updated for each new executor.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
