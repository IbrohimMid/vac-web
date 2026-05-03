---
id: wiring.declarative_pattern_adoption_audit
title: 'Declarative pattern adoption audit'
priority: P0
area: architecture-migration
owners:
  - bridge
  - web
  - protocol
status: landed  # Pass #25b audit: confirmed via artifacts ['docs/plans/wiring/generated-declarative-adoption-inventory.md']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Declarative pattern adoption audit

This plan identifies source-code surfaces that still encode control-plane intent imperatively and defines how to migrate them toward a VIL-inspired, Pythonic YAML control-plane without moving runtime authority out of Rust/TypeScript.

## Workflow-as-code control plane

```yaml
slice: wiring.declarative_pattern_adoption_audit
priority: P0
area: architecture-migration
owners:
  - bridge
  - web
  - protocol
depends_on:
  - wiring.command_manifest
  - wiring.protocol_schema_parity
  - wiring.config_capabilities_control_plane
sources:
  - apps/local-bridge/src/profile_layer/mod.rs
  - apps/local-bridge/src/translator/mod.rs
  - apps/local-bridge/src/session/handle.rs
  - apps/local-bridge/src/workflows
  - apps/web/src/components
  - apps/web/src/domain
  - tools/mock-engine/src/scenarios.rs
  - packages/protocol/v1
  - config
  - schema
outputs:
  - docs/plans/wiring/generated-declarative-adoption-inventory.md
  - scripts/check-declarative-pattern-adoption.mjs
  - docs/plans/wiring/catalogs/adoption-decisions.yaml
steps:
  - id: step_01
    do: 'Inventory hardcoded command catalogs, event names, workflow specs, mock scenarios, UI command senders, and UI event listeners.'
  - id: step_02
    do: 'Classify each surface as runtime logic, generated binding, declarative control-plane source, frontend-owned, or legacy/mock-only.'
  - id: step_03
    do: 'Move intent metadata into YAML/JSON-schema-backed control-plane files where appropriate.'
  - id: step_04
    do: 'Generate Rust/TypeScript bindings from declarative catalogs when drift would otherwise be likely.'
acceptance:
  - 'Every imperative command/event catalog has a migration decision.'
  - 'No YAML file can grant runtime power beyond Rust/TS enforcement.'
  - 'Agent/executor implementation tasks are small, readable, and mechanically actionable.'
  - 'Generated adoption inventory lists every hardcoded command/event/workflow/mock surface with a migration decision and owner.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Adoption rule

Use declarative YAML for **control-plane intent**:

- command catalog metadata;
- event taxonomy metadata;
- workflow specs;
- UI affordance gating metadata;
- mock scenario descriptions;
- agent/registry/config profiles;
- implementation slice plans.

Do **not** use YAML for runtime authority:

- ACP RPC execution;
- filesystem access;
- terminal/process spawning;
- authentication;
- persistence writes;
- security policy enforcement;
- destructive mutations.

Those remain Rust/TypeScript source of truth.

## Surfaces that still need pattern adoption

| Surface | Current style | Target pattern | Runtime owner |
|---|---|---|---|
| `profile_layer::KNOWN_COMMANDS` | hardcoded Rust array | generated from command implementation manifest YAML | Rust bridge |
| translator command match arms | hardcoded string arms | runtime handlers remain Rust; manifest generated from handlers or verified against YAML | Rust bridge |
| session ACP fallback routing | imperative command forwarding | classification-driven routing with `feature.not_wired` | Rust bridge |
| frontend `transport.send(...)` literals | scattered command strings | typed generated command helpers + capability gating | Web TS |
| frontend `transport.on(...)` literals | scattered event strings | typed generated event subscriptions + domain ownership map | Web TS |
| mock-engine scenario strings | imperative scenario match arms | declarative scenario YAML compiled/loaded by mock-engine | Tools Rust |
| protocol schema/generated SDK drift | schema + generated code + handlers separate | schema inventory drives manifest parity checks | Protocol tooling |
| workflow adapter mapping | imperative event classifier | adapter remains Rust; workflow YAML owns step graph and expected events | Rust bridge |
| config/agents/MCP registry | YAML exists but isolated | unified validated control-plane with capability refresh semantics | Rust bridge |

## Pythonic YAML style guide

YAML should be pleasant for agents/executors to edit:

```yaml
command: shell.start
status: not_wired
owner: bridge
requires:
  profile_tool: shell.exec
ui:
  gate: disabled
  reason: Shell backend is not implemented yet.
tests:
  - manifest_marks_shell_start_not_wired
  - shell_start_does_not_forward_to_acp
```

Rules:

- prefer flat maps over deeply nested objects;
- use obvious names, not framework jargon;
- one file per domain or slice;
- stable IDs over display names;
- comments explain why, not what;
- generated bindings must be deterministic;
- side effects require Rust/TS enforcement regardless of YAML.

## Implementation sequence

1. Command implementation manifest YAML + generated Rust/TS bindings.
2. Event taxonomy YAML + generated frontend/backend inventory checks.
3. UI affordance catalog YAML for command gating.
4. Mock scenario YAML parity with bridge event taxonomy.
5. Workflow registry spec cleanup using the same style.
6. CI gates that prevent reintroducing untracked imperative catalogs.
