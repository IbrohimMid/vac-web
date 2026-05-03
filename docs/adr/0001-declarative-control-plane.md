# ADR-0001: Declarative control plane, runtime authority in Rust + TypeScript

- Status: accepted
- Date: 2026-05-02
- Owners: architecture, bridge, web, protocol
- Related slice(s): wiring.declarative_pattern_adoption_audit (31), wiring.command_manifest (01), wiring.command_event_catalog_generation (32), wiring.workflow_authoring_rules (35)

## Context

VAC Web ships a local-first cockpit that bridges a TypeScript UI to a Rust
local-bridge over a constrained protocol. We want to keep two properties
as the codebase grows:

1. **Agents and humans can extend the system safely.** New commands,
   events, workflows, capability profiles, and mock scenarios should be
   describable in declarative YAML/JSON without writing brittle runtime
   plumbing.
2. **Runtime safety is not negotiable.** Profile policy, auth, persistence,
   and gate logic must remain in Rust/TypeScript, where the type system,
   tests, and red-team coverage live.

Without a clear rule, we drift into either "YAML-as-code" (where YAML can
weaken security) or "imperative everything" (where each new command means
rewriting plumbing in three layers).

## Decision

* **YAML and JSON Schema files describe control-plane intent.** Examples:
  `config/control-plane/command-manifest.yaml`,
  `config/control-plane/event-catalog.yaml`,
  `config/profiles/*.yaml`,
  `examples/workflows/*.yaml`,
  `tools/mock-engine/scenarios/*.yaml`.
* **Rust and TypeScript carry runtime authority.** Examples:
  `apps/local-bridge/src/profile_layer/`,
  `apps/local-bridge/src/translator/`,
  `apps/web/src/domain/capabilities/*.ts`.
* **Generated code is the only acceptable bridge.** Codegen scripts
  produce typed bindings (e.g.
  `apps/local-bridge/src/generated/command_catalog.rs`,
  `apps/web/src/generated/commandCatalog.ts`). Generated files carry a
  drift CI check.
* **No YAML may grant runtime power beyond what Rust/TS enforces.**

## Alternatives considered

- _All-imperative._ Rejected: every new command requires changes in 3–4
  files and is hard for agents to land safely.
- _All-declarative (YAML executes)._ Rejected: erodes the security
  boundary; YAML cannot be statically verified the way Rust/TS can.
- _Schema-only declarative (no codegen)._ Rejected: the gap between YAML
  and runtime drifts and is not enforced.

## Consequences

- Positive: agents/executors can implement a slice from YAML alone; UX
  copy is centralized in capability modules; CI catches drift.
- Negative: requires discipline (drift checks, codegen) and a small
  upfront authoring overhead.
- Migrations required: ongoing slices 31–35 port existing imperative
  catalogs to declarative form.

## Migration plan

1. Slice 31 — produce the adoption inventory (done).
2. Slice 32 — author canonical event catalog and codegen (event YAML
   landed; codegen pipeline planned).
3. Slice 33 — frontend affordance catalog (TS module landed).
4. Slice 34 — mock scenario YAML schema + first scenarios (landed).
5. Slice 35 — workflow authoring rules + reference workflow (landed).
6. Validation gates remain green throughout: `pnpm typecheck`,
   `pnpm test --run`, `pnpm lint`, `cargo check`, `cargo test`.
