---
id: wiring.connectors
title: 'Connector registry, auth, health, and capability taxonomy'
priority: P2
area: connectors
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/agent_runtime']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Connector registry, auth, health, and capability taxonomy

Separate connector availability, configuration, auth, health, rate limits, and write capabilities.

## Workflow-as-code control plane

```yaml
slice: wiring.connectors
priority: P2
area: connectors
owners:
  - bridge
  - web
depends_on:
  - wiring.command_manifest
  - wiring.auth_ws_security
sources:
  - docs/connectors.md
  - apps/web/src/components/Connectors
  - apps/web/src/domain/connectors
  - packages/protocol/v1/command.schema.json
backend_surface:
  - connector.list
  - connector.connect
  - connector.disconnect
  - connector.health
  - connector.capabilities
  - connector.connected
  - connector.disconnected
  - connector.rate_limited
  - connector.oauth_url
  - connector.write.*
frontend_surface:
  - ConnectorsTab
  - connector store
steps:
  - id: step_01
    do: 'Implement v0 local registry + health only.'
  - id: step_02
    do: 'Keep OAuth/connect/disconnect not_wired until real auth exists.'
  - id: step_03
    do: 'Expose connector.capabilities as metadata, not auth proof.'
  - id: step_04
    do: 'Treat write capabilities as policy-enforced separate phase.'
acceptance:
  - 'Rows distinguish available/configured/connected/rate_limited/not_wired.'
  - 'No UI claims external access before token/auth state exists.'
  - 'Write-capable connectors require explicit profile permission.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
