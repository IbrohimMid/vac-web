---
id: wiring.fixtures_scripts_repo_hygiene
title: 'Fixtures, scripts, schema, and repository hygiene'
priority: P1
area: repo-hygiene
owners:
  - dx
  - bridge
  - qa
  - docs
status: landed  # Pass #25b audit: confirmed via artifacts ['scripts', 'fixtures']
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Fixtures, scripts, schema, and repository hygiene

Final coverage scan found repo assets that were only implicitly covered by broader DX/testing/config plans. This slice makes them explicit and executable.

## Workflow-as-code control plane

```yaml
slice: wiring.fixtures_scripts_repo_hygiene
priority: P1
area: repo-hygiene
owners:
  - dx
  - bridge
  - qa
  - docs
depends_on:
  - wiring.dx_tooling_scaffolding
  - wiring.testing_strategy_pyramid
  - wiring.agent_registry_mcp
  - wiring.docs_information_architecture
sources:
  - fixtures
  - scripts
  - tests/integration
  - schema/v1
  - config/README.md
  - config/vac.yaml
  - config/sessions
  - .github/ISSUE_TEMPLATE
  - .github/PULL_REQUEST_TEMPLATE.md
  - .github/dependabot.yml
outputs:
  - docs/plans/wiring/generated-repo-hygiene-inventory.md
  - scripts/check-repo-hygiene.mjs
  - schema/fixtures/agent-fixture.schema.json
  - fixtures/README.md
steps:
  - id: step_01
    do: 'Inventory all fixture TOML files, scripts, integration tests, schema/v1 assets, config root files, and GitHub templates.'
  - id: step_02
    do: 'Classify every fixture as smoke, regression, provider-specific, or deprecated.'
  - id: step_03
    do: 'Define ownership and expected validation command for every script.'
  - id: step_04
    do: 'Add fixture/schema/template hygiene check to CI or local vac:check all.'
acceptance:
  - 'Every fixture file has owner, purpose, provider/runtime scope, and validation command.'
  - 'Every script has documented purpose, inputs, outputs, and replacement/deprecation status.'
  - 'Integration tests are mapped to the test matrix and not orphaned.'
  - 'GitHub templates and dependabot config are included in docs governance.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Fixtures discovered in final scan

```text
fixtures/agents.claude.toml
fixtures/agents.qwen-code-acp.toml
fixtures/agents.kimi-cli-acp.toml
fixtures/agents.all-acp.toml
fixtures/agents.gemini-acp.toml
fixtures/agents.github-copilot-acp.toml
fixtures/agents.codex-acp.toml
fixtures/agents.opencode.toml
fixtures/agents.claude-agent-acp.toml
fixtures/agents.multi.toml
```

## Rule

Fixtures are part of the control-plane test surface. They should not be random sample files. Treat them as executable examples:

```yaml
fixture: agents.gemini-acp.toml
kind: agent_registry_fixture
provider: gemini
runtime: acp
purpose: smoke
validated_by:
  - cargo test -p local-bridge session_lifecycle
  - docs/plans/wiring/26-agent-registry-mcp.md
```

## Scripts rule

Scripts are DX/API surfaces. Each script must declare:

```yaml
script: scripts/codegen.sh
owner: protocol
purpose: regenerate protocol SDKs
inputs:
  - packages/protocol/v1
outputs:
  - packages/protocol-ts/src/v1/generated
  - packages/protocol-rs/src/v1/generated
called_by:
  - tools/codegen
  - ci.codegen-check
```

This closes the last implicit repo-hygiene areas from the final scan.
