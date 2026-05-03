---
id: wiring.observability_slos
title: 'Observability, audit, and operational SLOs'
priority: P1
area: observability
owners:
  - bridge
  - web
  - ops
status: landed  # Pass #24 audit: confirmed landed (output paths all exist)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Observability, audit, and operational SLOs

Define structured logging, audit trails, health indicators, degraded states, and operational SLOs for local cockpit workflows.

## Workflow-as-code control plane

```yaml
slice: wiring.observability_slos
priority: P1
area: observability
owners:
  - bridge
  - web
  - ops
depends_on:
  - wiring.audit_observability
  - wiring.error_taxonomy_recovery
sources:
  - apps/local-bridge/src/audit
  - apps/local-bridge/src/notify
  - apps/local-bridge/src/session/persistence
  - apps/web/src/domain/notify
  - docs/perf-test-plan.md
outputs:
  - docs/observability.md
  - schema/observability-events.yaml
steps:
  - id: step_01
    do: 'Define structured log fields for command, event, session, agent, workflow, and audit actions.'
  - id: step_02
    do: 'Define operator-facing health/degraded states.'
  - id: step_03
    do: 'Add SLOs for command ACK latency, event delivery, persistence writes, and UI render budgets.'
  - id: step_04
    do: 'Map observability events to notify lane or diagnostics panels.'
acceptance:
  - 'Every side-effect command has audit event.'
  - 'Degraded persistence/auth/config states are visible.'
  - 'Performance and reliability budgets are documented and testable.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## SLO candidates

```yaml
slos:
  command_ack_p95_ms: 250
  websocket_event_delivery_p95_ms: 250
  persisted_event_write_p95_ms: 100
  topbar_interaction_p95_ms: 100
  command_manifest_refresh_p95_ms: 250
```

These are targets, not promises, until measured in CI/local perf runs.
