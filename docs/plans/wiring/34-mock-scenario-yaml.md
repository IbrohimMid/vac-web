---
id: wiring.mock_scenario_yaml
title: 'Mock scenario YAML parity'
priority: P1
area: testing-tools
owners:
  - tools
  - web
  - bridge
status: landed  # Pass #24 audit: confirmed landed via combined evidence (outputs + wave-summary mentions)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Mock scenario YAML parity

Move mock-engine scenarios away from imperative string-heavy scenario code toward declarative YAML scenarios that use canonical command/event catalogs.

## Workflow-as-code control plane

```yaml
slice: wiring.mock_scenario_yaml
priority: P1
area: testing-tools
owners:
  - tools
  - web
  - bridge
depends_on:
  - wiring.command_event_catalog_generation
  - wiring.mock_engine_parity
sources:
  - tools/mock-engine/src/scenarios.rs
  - tools/mock-engine/README.md
  - tools/mock-acp
  - apps/web/src/domain
outputs:
  - schema/mock-scenario.schema.json
  - tools/mock-engine/scenarios/*.yaml
  - tools/mock-engine/src/generated/scenario_catalog.rs
  - docs/plans/wiring/generated-mock-scenario-inventory.md
steps:
  - id: step_01
    do: 'Define scenario YAML schema with command input, event timeline, timing, and assertions.'
  - id: step_02
    do: 'Port mock-only scenarios to YAML and mark their status explicitly.'
  - id: step_03
    do: 'Make mock-engine validate event IDs against generated event catalog.'
  - id: step_04
    do: 'Prevent tests from depending on mock-only events without compatibility adapter.'
acceptance:
  - 'Mock scenarios use canonical event IDs or declare legacy_mock_only status.'
  - 'changeset.* scenarios are replaced by review.* or explicitly scoped to compatibility tests.'
  - 'Mock-engine cannot hide local-bridge wiring gaps.'
  - 'At least one canonical scenario YAML is schema-validated and loaded by mock-engine.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Proposed scenario shape

```yaml
scenario: shell_basic_output
status: future_when_shell_backend_lands
input:
  command: shell.start
  payload:
    cwd: project_root
timeline:
  - event: shell.started
    payload:
      shell_id: sh_01
  - event: shell.output
    payload:
      shell_id: sh_01
      chunk: hello
assertions:
  - ShellDrawer shows hello
  - shell.kill terminates sh_01
```

This makes scenarios readable and maintainable for agents while keeping the mock-engine runtime in Rust.
