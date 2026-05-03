# Workflow authoring rules (slice 35)

_Companion to `docs/plans/wiring/35-workflow-authoring-rules.md`. This is the day-to-day playbook for adding a new workflow / control-plane feature._

## 1. Write declarative YAML first

For every new product flow, before writing runtime Rust or UI React, draft a declarative spec under `examples/workflows/<flow>.yaml` (or another agreed location). Use the canonical shape:

```yaml
workflow: <namespace>.<verb>
version: 1
status: planned | in_progress | shipped
states: [idle, in_progress, success, failed, ...]
events:
  - id: <event-name>
    transitions: { from: <state>, to: <state> }
failure_reasons: [<bucket>, ...]
ui:
  surface: <component>
  module: apps/web/src/domain/capabilities/<module>.ts
runtime_authority:
  layer: rust
  module: apps/local-bridge/src/workflows/<file>.rs
```

The reference example is `examples/workflows/assess-index-rebuild.yaml`.

Acceptance checks:

* The YAML must validate against `schema/workflow-control-plane.schema.json` (planned schema).
* Every event ID must already exist in the canonical event catalog (slice 32) or be flagged as `status: planned` until the catalog is updated.

## 2. Implement runtime authority in Rust / TypeScript

* Rust workflow executor / adapters under `apps/local-bridge/src/workflows/` carry runtime side effects (filesystem, terminal, persistence, network).
* No new Axum / WebSocket route may carry control-plane intent that is not first declared in the YAML spec.
* No YAML may grant runtime power beyond what the Rust executor already enforces.

## 3. Bind UI with generated constants and capability modules

* UI consumes generated event/command IDs from `apps/web/src/generated/commandCatalog.ts` (and the planned event catalog).
* All copy / state mapping lives in `apps/web/src/domain/capabilities/<module>.ts` so multiple surfaces share a single source of truth.
* No surface should invent local state machines or local copy strings for events that already have a capability module.

## 4. Tests

Every new workflow ships:

1. Schema test — the YAML parses and validates.
2. Runtime test — cargo test for the Rust executor / adapter.
3. UI test — vitest for the capability module and any new component.

## 5. Validation gates (always run)

```
pnpm --filter @vac-web/web typecheck
pnpm --filter @vac-web/web test -- --run
pnpm --filter @vac-web/web lint
cargo check -p local-bridge
```

If the slice touches the mock engine, also run `cargo test -p mock-engine`.

## 6. Anti-patterns to refuse

* Adding a new bridge command without an entry in `config/control-plane/command-manifest.yaml`.
* Hand-rolling event copy in a UI component instead of in `apps/web/src/domain/capabilities/`.
* Returning `ok: true` from a `feature.not_wired` codepath.
* Letting YAML files grant runtime power (e.g. arbitrary command execution).

## 7. Agent DX goal

An agent or executor should be able to implement a workflow slice from the YAML alone, by:

1. Reading the spec.
2. Writing the Rust executor with the same state machine.
3. Writing the capability module with the same copy + transitions.
4. Wiring the UI surface and adding tests.

When this loop is broken, file a docs follow-up before adding more YAML.
