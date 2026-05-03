---
id: wiring.mock_engine_parity
title: 'Mock engine parity and scenario hygiene'
priority: P1
area: testing-tools
owners:
  - tools
  - web
  - bridge
status: landed  # Pass #25 audit: confirmed via artifact paths ['tools/mock-engine', 'tools/mock-engine/src/scenarios.rs']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Mock engine parity and scenario hygiene

Keep mock-engine scenarios aligned with canonical backend event names and avoid validating dead/mock-only surfaces.

## Workflow-as-code control plane

```yaml
slice: wiring.mock_engine_parity
priority: P1
area: testing-tools
owners:
  - tools
  - web
  - bridge
depends_on:
  - wiring.protocol_schema_parity
  - wiring.review_taxonomy
sources:
  - tools/mock-engine/src/scenarios.rs
  - tools/mock-engine/README.md
  - tools/mock-acp
  - apps/web/src/domain
backend_surface:
  - changeset.updated
  - release.*
  - connector.*
  - shell.*
  - runtime.job.upserted
  - transcript.message_added
frontend_surface:
  - web tests using mock-engine scenarios
steps:
  - id: step_01
    do: 'Mark mock-only events explicitly.'
  - id: step_02
    do: 'Replace changeset.* scenarios with canonical review.* or adapter tests.'
  - id: step_03
    do: 'Ensure mock-engine cannot hide local-bridge gaps.'
  - id: step_04
    do: 'Add scenario parity check against protocol schema and command manifest.'
acceptance:
  - 'Tests do not pass only because mock-engine emits events local-bridge never emits.'
  - 'Mock-only surfaces are labeled in plans and code comments.'
  - 'Mock ACP covers provider metadata/usage telemetry cases.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
