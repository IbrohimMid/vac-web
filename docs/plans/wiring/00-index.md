---
id: wiring.index
title: 'Wiring plan set index'
priority: P0
area: planning
owners:
  - bridge
  - web
  - protocol
status: landed  # Pass #25c audit: index file itself; 51 / 53 referenced plans now landed (Pass #20-#25 cumulative); only this index + wave-summary references remain
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Wiring plan set index

Index for the split backend/UI wiring plan set. This replaces the monolithic plan as the actionable SSOT.

## Workflow-as-code control plane

```yaml
slice: wiring.index
priority: P0
area: planning
owners:
  - bridge
  - web
  - protocol
depends_on:
  - none
sources:
  - apps/local-bridge/src
  - apps/web/src
  - packages/protocol
  - packages/profile-core
  - tools/mock-engine
  - docs/plans/wiring
steps:
  - id: step_01
    do: 'Use this directory as the active plan set, not the old monolithic plan.'
  - id: step_02
    do: 'Keep each slice small enough to implement and test independently.'
  - id: step_03
    do: 'Treat YAML blocks as declarative control-plane metadata; keep runtime truth in Rust/TS.'
acceptance:
  - 'Every planned slice has owners, source files, backend surfaces, frontend surfaces, and validation gates.'
  - 'Index links all split plans.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Implementation notes

The YAML block above is a declarative control-plane contract. It should be easy for agents and executors to read, edit, and sequence. It does not replace bridge runtime enforcement.

This plan set is VIL-inspired in structure: each plan is declarative workflow-as-code metadata plus implementation notes. The YAML should feel Pythonic for agents/executors: readable, composable, low ceremony, and easy to maintain. It is not a copy of VIL implementation. The bridge runtime, security checks, persistence, ACP, filesystem, and terminal behavior remain source-of-truth code in Rust and TypeScript.

## Plan files

- [01-command-manifest.md](./01-command-manifest.md) — Command implementation manifest (P0, control-plane).
- [02-not-wired-fallback.md](./02-not-wired-fallback.md) — Structured not-wired fallback (P0, bridge).
- [03-session-model-context.md](./03-session-model-context.md) — Session model, mode, config, slash commands, and context telemetry (P0, session-acp).
- [04-assessment-index.md](./04-assessment-index.md) — Assessment index lifecycle (P1, assessment).
- [05-review-taxonomy.md](./05-review-taxonomy.md) — Review event taxonomy and file actions (P0, review).
- [06-approval-lifecycle.md](./06-approval-lifecycle.md) — Approval lifecycle completeness (P1, approvals).
- [07-handoff-errors.md](./07-handoff-errors.md) — Handoff error-state surfacing (P1, handoff).
- [08-shell-terminal-boundary.md](./08-shell-terminal-boundary.md) — Shell commands and ACP terminal boundary (P1, terminal).
- [09-session-rename-history.md](./09-session-rename-history.md) — Session rename, close, history, resume states (P1, session-history).
- [10-registry-config-reload.md](./10-registry-config-reload.md) — Registry reload and config validation UX (P1, config-registry).
- [11-runtime-jobs.md](./11-runtime-jobs.md) — Runtime job model and cancellation (P2, runtime).
- [12-gates-governance.md](./12-gates-governance.md) — Gates, signoff, override, and governance state (P2, gates).
- [13-connectors.md](./13-connectors.md) — Connector registry, auth, health, and capability taxonomy (P2, connectors).
- [14-release.md](./14-release.md) — Release event contract and safe deploy boundaries (P2, release).
- [15-migration-continuous.md](./15-migration-continuous.md) — Migration and continuous config hold (P3, migration-continuous).
- [16-context-palette.md](./16-context-palette.md) — Mention search, attachments, and palette invoke (P2, composer-palette).
- [17-overlay-workbench-plan.md](./17-overlay-workbench-plan.md) — Overlay, workbench, and plan ownership (P2, ui-command-ownership).
- [18-workflow-engine.md](./18-workflow-engine.md) — Workflow engine, adapters, and workflow-as-code registry (P1, workflows).
- [19-protocol-schema-parity.md](./19-protocol-schema-parity.md) — Protocol schema, generated SDK, and bridge parity (P0, protocol).
- [20-profile-policy-enforcement.md](./20-profile-policy-enforcement.md) — Profile-core policy and side-effect enforcement (P0, security-policy).
- [21-auth-ws-security.md](./21-auth-ws-security.md) — Auth, WebSocket envelope, and session security (P0, auth-ws).
- [22-persistence-replay-redaction.md](./22-persistence-replay-redaction.md) — Persistence, replay, history, and redaction (P1, persistence).
- [23-notify-overlay-ux.md](./23-notify-overlay-ux.md) — Notify lane, overlays, and operator attention model (P2, notification-ux).
- [24-mock-engine-parity.md](./24-mock-engine-parity.md) — Mock engine parity and scenario hygiene (P1, testing-tools).
- [25-codegen-sdk-drift.md](./25-codegen-sdk-drift.md) — Codegen and SDK drift checks (P0, codegen).
- [26-agent-registry-mcp.md](./26-agent-registry-mcp.md) — Agent registry, MCP servers, provider metadata, and trust boundaries (P1, agent-registry).
- [27-config-capabilities-control-plane.md](./27-config-capabilities-control-plane.md) — Declarative config and capability control plane (P0, config-control-plane).
- [28-ci-validation-gates.md](./28-ci-validation-gates.md) — CI validation gates for wiring slices (P0, ci).
- [29-audit-red-team-observability.md](./29-audit-red-team-observability.md) — Audit trail, red-team cases, and observability (P1, audit-observability).
- [30-product-surface-roadmap.md](./30-product-surface-roadmap.md) — Product surface implementation roadmap (P0, roadmap).

- [31-declarative-pattern-adoption-audit.md](./31-declarative-pattern-adoption-audit.md) — Declarative pattern adoption audit (P0, architecture-migration).
- [32-command-event-catalog-generation.md](./32-command-event-catalog-generation.md) — Command and event catalog generation (P0, codegen-control-plane).
- [33-frontend-declarative-affordances.md](./33-frontend-declarative-affordances.md) — Frontend declarative affordance catalog (P1, web-control-plane).
- [34-mock-scenario-yaml.md](./34-mock-scenario-yaml.md) — Mock scenario YAML parity (P1, testing-tools).
- [35-workflow-authoring-rules.md](./35-workflow-authoring-rules.md) — Workflow authoring rules (P1, workflows).

- [36-enterprise-maturity-scorecard.md](./36-enterprise-maturity-scorecard.md) — Enterprise maturity scorecard (P0, architecture-governance).
- [37-module-boundaries-layering.md](./37-module-boundaries-layering.md) — Module boundaries and layering fitness tests (P0, architecture-fitness).
- [38-adr-governance.md](./38-adr-governance.md) — Architecture decision records and governance (P1, architecture-governance).
- [39-dx-tooling-scaffolding.md](./39-dx-tooling-scaffolding.md) — DX tooling and scaffolding (P0, developer-experience).
- [40-error-taxonomy-recovery.md](./40-error-taxonomy-recovery.md) — Error taxonomy and recovery UX (P0, error-handling).
- [41-observability-slos.md](./41-observability-slos.md) — Observability, audit, and operational SLOs (P1, observability).
- [42-testing-strategy-pyramid.md](./42-testing-strategy-pyramid.md) — Testing strategy pyramid and contract gates (P0, testing).
- [43-security-supply-chain.md](./43-security-supply-chain.md) — Security and supply-chain maturity (P0, security).
- [44-data-contract-versioning.md](./44-data-contract-versioning.md) — Data contracts, versioning, and migrations (P1, data-contracts).
- [45-generated-code-ownership.md](./45-generated-code-ownership.md) — Generated code ownership and edit policy (P0, codegen).
- [46-docs-information-architecture.md](./46-docs-information-architecture.md) — Documentation information architecture (P1, docs-dx).
- [47-extension-plugin-boundaries.md](./47-extension-plugin-boundaries.md) — Extension and plugin boundaries (P2, extensibility).

- [48-external-best-practice-benchmark.md](./48-external-best-practice-benchmark.md) — External best-practice benchmark for declarative control-plane architecture (P0, architecture-benchmark).

- [49-fixtures-scripts-repo-hygiene.md](./49-fixtures-scripts-repo-hygiene.md) — Fixtures, scripts, schema, and repository hygiene (P1, repo-hygiene).
- [50-web-rendering-worker-pipeline.md](./50-web-rendering-worker-pipeline.md) — Web rendering, markdown, highlight, transcript, and worker pipeline (P1, web-runtime-dx).

## Design posture

Use declarative YAML to make implementation slices feel agent-friendly and Pythonic: obvious keys, compact maps, deterministic lists, and minimal boilerplate. The YAML is the control-plane contract; it should energize agents/executors because each slice is small, legible, and mechanically actionable. Rust/TypeScript remains the runtime source of truth for side effects, auth, persistence, ACP, filesystem, terminal, and security.
