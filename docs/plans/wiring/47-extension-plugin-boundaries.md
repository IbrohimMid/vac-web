---
id: wiring.extension_plugin_boundaries
title: 'Extension and plugin boundaries'
priority: P2
area: extensibility
owners:
  - architecture
  - bridge
  - security
status: landed  # Pass #25b audit: confirmed via artifacts ['docs/extension-boundaries.md']; 2026-05-06 R5 closeout (Phase 1 design): docs/extension-trust-model.md (124 lines, 8 sections) + docs/adr/0003-extension-trust-model.md + cross-link in extension-boundaries.md + outputs frontmatter extended; Phase 2 runtime enforce_extension_trust + drift gate tracked separately
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Extension and plugin boundaries

Define safe boundaries for future providers, connectors, MCP servers, workflows, and plugins without weakening runtime enforcement.

## Workflow-as-code control plane

```yaml
slice: wiring.extension_plugin_boundaries
priority: P2
area: extensibility
owners:
  - architecture
  - bridge
  - security
depends_on:
  - wiring.agent_registry_mcp
  - wiring.security_supply_chain
  - wiring.config_capabilities_control_plane
sources:
  - apps/local-bridge/src/agent_runtime
  - apps/local-bridge/src/config
  - config/mcp/servers.yaml
  - config/agents/registry.yaml
  - docs/connectors.md
outputs:
  - docs/extension-boundaries.md
  - docs/extension-trust-model.md
  - docs/adr/0003-extension-trust-model.md
  - schema/plugin-capabilities.schema.json
steps:
  - id: step_01
    do: 'Define extension types: agent provider, MCP server, connector, workflow spec, UI affordance.'
  - id: step_02
    do: 'Define which extension data can be declarative YAML and which requires compiled Rust/TS support.'
  - id: step_03
    do: 'Add trust and signing/allowlist model for future dynamic extension loading.'
  - id: step_04
    do: 'Keep current implementation bundled/allowlisted until security model is mature.'
acceptance:
  - 'No plugin can bypass profile policy.'
  - 'Dynamic extension loading is not added without trust model ADR.'
  - 'Agent/connector/workflow extension boundaries are documented and testable.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block is a readable control-plane contract for agents/executors. It describes intent, ownership, dependencies, checks, and acceptance criteria. It does not replace runtime authority: Rust and TypeScript remain responsible for side effects, auth, persistence, ACP, filesystem, terminal, and security.

## Boundary table

```yaml
extensions:
  agent_provider:
    declarative: registry metadata
    runtime: compiled adapter or approved command
  mcp_server:
    declarative: server config
    runtime: bridge policy + auth enforcement
  connector:
    declarative: capabilities and health metadata
    runtime: auth + API adapter
  workflow:
    declarative: bundled allowlisted YAML
    runtime: Rust executor
```

Extensibility should not become arbitrary code execution.
