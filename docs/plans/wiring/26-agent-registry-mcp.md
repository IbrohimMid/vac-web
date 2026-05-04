---
id: wiring.agent_registry_mcp
title: 'Agent registry, MCP servers, provider metadata, and trust boundaries'
priority: P1
area: agent-registry
owners:
  - bridge
  - web
status: landed  # Pass #25 audit: confirmed via artifact paths ['apps/local-bridge/src/agent_runtime']; Pass #26 deep audit: P26 acceptance verified — registry.trust_violation + session.mcp_server_drift both isRegistryBlocking; McpDriftPolicy warn/fail/ignore in resume_policy.rs; trust violations not refresh-suppressed (see wave-summary-2026-05-03.md)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Agent registry, MCP servers, provider metadata, and trust boundaries

Audit agent registry, provider metadata, MCP server drift, and registry trust violations.

## Workflow-as-code control plane

```yaml
slice: wiring.agent_registry_mcp
priority: P1
area: agent-registry
owners:
  - bridge
  - web
depends_on:
  - wiring.registry_config_reload
  - wiring.auth_ws_security
sources:
  - apps/local-bridge/src/agent_runtime/config.rs
  - apps/local-bridge/src/agent_runtime/registry.rs
  - apps/local-bridge/src/agent_runtime/registry_sync.rs
  - apps/local-bridge/src/session/registry.rs
  - schema/config/agent-registry.schema.json
  - apps/web/src/components/SessionPicker
backend_surface:
  - registry.sync
  - registry.add
  - registry.trust_violation
  - session.mcp_server_drift
  - agent.mcp_servers
  - agents.registry
frontend_surface:
  - SessionPicker
  - RegistryBrowser
  - RunAssessmentDrawer
steps:
  - id: step_01
    do: 'Expose registry trust violation as visible error.'
  - id: step_02
    do: 'Show MCP server drift on session creation/resume.'
  - id: step_03
    do: 'Keep provider metadata display read-only unless bridge supports mutation.'
  - id: step_04
    do: 'Refresh agent registry after config reload.'
acceptance:
  - 'User can see why an agent is disabled/untrusted.'
  - 'MCP drift blocks or warns according to policy.'
  - 'Registry UI does not hide trust violations.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.
