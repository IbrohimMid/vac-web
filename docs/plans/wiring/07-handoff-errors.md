---
id: wiring.handoff_errors
title: 'Handoff error-state surfacing'
priority: P1
area: handoff
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/handoff', 'apps/local-bridge/src/handoff/packet.rs']; Pass #27 deep audit: P07 acceptance verified — 7 handoff error events emit with reason_tag+reason (translator/mod.rs:2588-3344); handoff.invalid_state used at 6 state-machine guard sites (handoff/mod.rs); PacketDetail surfaces all variants; success+failure share one state machine (see wave-summary-2026-05-03.md)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Handoff error-state surfacing

Surface all handoff failure variants in packet detail, audit trail, and notifications.

## Workflow-as-code control plane

```yaml
slice: wiring.handoff_errors
priority: P1
area: handoff
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
sources:
  - apps/local-bridge/src/handoff
  - apps/local-bridge/src/translator/mod.rs
  - apps/web/src/domain/handoff
  - apps/web/src/components/Handoff
backend_surface:
  - handoff.approve_failed
  - handoff.reject_failed
  - handoff.dispatch_rejected
  - handoff.dispatch_state_error
  - handoff.execution_bind_failed
  - handoff.execution_failed
  - handoff.invalid_state
  - handoff.created
  - handoff.approved
  - handoff.rejected
frontend_surface:
  - HandoffBuilder
  - PacketDetail
  - handoff store
steps:
  - id: step_01
    do: 'Map every handoff error to packet detail state.'
  - id: step_02
    do: 'Add sticky notification only for operator-actionable failures.'
  - id: step_03
    do: 'Classify handoff.fetch/export_blueprint/cancel/dispatch_web_cli.'
  - id: step_04
    do: 'Make retry CTA state-dependent.'
acceptance:
  - 'User can decide whether to re-approve, recreate, fix pin drift, wait, or inspect logs.'
  - 'No handoff error is console-only.'
  - 'Success/failure transitions share one state machine.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
