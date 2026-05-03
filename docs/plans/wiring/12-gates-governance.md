---
id: wiring.gates_governance
title: 'Gates, signoff, override, and governance state'
priority: P2
area: gates
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/web/src/stores/gates.ts', 'apps/web/src/stores/gates.test.ts']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Gates, signoff, override, and governance state

Add bridge-owned gate state before enabling signoff/override controls.

## Workflow-as-code control plane

```yaml
slice: wiring.gates_governance
priority: P2
area: gates
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
  - wiring.audit_observability
sources:
  - docs/gates.md
  - apps/web/src/components/Gates
  - apps/web/src/domain/gates
  - apps/local-bridge/src
backend_surface:
  - gate.evaluate
  - gate.signoff
  - gate.override
  - gate.revoke_override
  - gate.changed
  - gate.state_changed
  - gate.override_applied
  - gate.override_revoked
frontend_surface:
  - GateDetail
  - GateRibbon
  - gate store
steps:
  - id: step_01
    do: 'Define bridge gate state module.'
  - id: step_02
    do: 'Require reason and expiry for overrides.'
  - id: step_03
    do: 'Disable signoff/override until persistence and audit exist.'
  - id: step_04
    do: 'Map protocol gate events to one store taxonomy.'
acceptance:
  - 'Signoff persists.'
  - 'Override is auditable and expires.'
  - 'Release/deploy controls respect gate readiness.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
