---
id: wiring.section_a_resolver_extensions
title: 'Section A resolver extensions for mock-engine YAML scenarios'
priority: P2
area: tooling
owners:
  - mock-engine
  - bridge
status: planned  # design pass; implementation tracked separately
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Section A resolver extensions for mock-engine YAML scenarios

Design spec for the three resolver primitives required to port the remaining 8 handler families from `tools/mock-engine/src/legacy_scenarios.rs` to YAML-driven scenarios:

- `message.submit`
- `context.mention_search`
- `assessment.run`
- `handoff.create` / `handoff.approve` / `handoff.dispatch_local`
- `release.deploy` / `release.generate_notes`

Per Pass #11 / #22 architecture decision, these stay imperative until the resolver primitives below land. Continuation #9 already split `scenarios.rs` (thin dispatcher) from `legacy_scenarios.rs` (imperative handlers); this design extends the dispatcher with three primitives so handlers can migrate one-by-one into YAML.

## Primitive 1 — Counter-based hash generator

### Why

`release.deploy` must surface a deterministic 7-character commit hash that changes per call but is reproducible across replays. Same constraint applies to `handoff.dispatch_local` (run_id), `assessment.run` (correlation_id), and any future handler emitting opaque ids that should not collide between calls.

### Spec

New generator names (additions to existing `@next_shell_id` / `@session_id` etc. in `build_bindings`):

```
@hash_7(seed)        -> 7-char hex from sha256(seed + counter); counter persists per State
@hash_12(seed)       -> 12-char hex variant for longer ids (run_ids, dispatch_ids)
@uuid_v7()           -> RFC 9562 UUIDv7 (sortable, time-prefixed)
```

### State change in `legacy_scenarios::State`

Add a single `hash_counter: AtomicU64` (or `Cell<u64>` + `&mut self` since dispatch is single-threaded). Each `@hash_*(seed)` call increments and returns `sha256(seed.as_bytes() ++ counter.to_le_bytes())[..N]` hex.

### YAML usage

```yaml
scenario: release_deploy
run_id: '$input.target_id'
input:
  command: release.deploy
state_seeds:
  - var: deploy_id
    value: '@hash_7(deploy_id)'
  - var: commit_id
    value: '@hash_7(release.deploy)'
timeline:
  - after_ms: 0
    event: release.deploy_progress
    payload:
      deploy_id: '${deploy_id}'
      stage: pull
      progress: 0.1
```

Deterministic across the same seed sequence — replays reproduce the same ids. Different seeds yield different ids without coordination.

### Tests

- `hash_7_seeds_distinct_inputs_to_distinct_outputs` (collision check on 1k seeds)
- `hash_7_returns_lowercase_hex`
- `hash_7_is_seed_dependent_not_global` (state created twice gives same sequence per seed)

## Primitive 2 — Multi-event ledger

### Why

`handoff.create` emits 3-5 events as a sequence (`handoff.created` then `handoff.dispatch_allowed` then optionally `handoff.dispatch_state_error`) where later events depend on state computed by earlier events (e.g., `signers` from `handoff.created` referenced in `handoff.approved` payload).

Current `state_seeds` are evaluated once at scenario start. Multi-step handlers need to compute additional bindings *between* timeline steps.

### Spec

Extend timeline step with optional `state_seeds_after` block that runs in the bindings scope before subsequent steps:

```yaml
timeline:
  - after_ms: 0
    event: handoff.created
    payload:
      packet_id: '${packet_id}'
      signers: ['alice', 'bob']
    state_seeds_after:
      - var: required_signers_count
        value: '@count(signers)'
      - var: first_signer
        value: '@first(signers)'
  - after_ms: 50
    event: handoff.dispatch_allowed
    payload:
      packet_id: '${packet_id}'
      required: ${required_signers_count}
      lead_approver: '${first_signer}'
```

New bindings-scope generators: `@count(<binding_name>)`, `@first(<binding_name>)`, `@last(<binding_name>)`, `@nth(<binding>, <index>)`.

### State change

`render_value` already walks the bindings; extend `try_runtime_dispatch` to re-run a small `eval_seeds_after(step, &mut bindings, state)` after each step before pushing the rendered notification.

### Codegen

`scenario_catalog.rs` `TimelineStep` struct gains a `state_seeds_after: &'static [SeedDirective]` field (empty slice for current 21 scenarios). Drift gate enforces shape.

### Tests

- `state_seeds_after_runs_between_steps`
- `count_first_last_nth_generators_resolve_array_bindings`
- `unknown_binding_in_state_seeds_after_falls_back_to_empty`

## Primitive 3 — Filtering DSL for query-driven scenarios

### Why

`context.mention_search` body in legacy is:

```rust
let matches: Vec<_> = haystack.iter()
    .filter(|p| query.is_empty() || p.contains(query))
    .collect();
```

This cannot be expressed in pure templates. The query is operator input; the haystack is a fixture; the output is a filtered subset.

### Spec

New timeline step kind: `filter_then_emit`.

```yaml
timeline:
  - after_ms: 0
    filter_then_emit:
      from: '@fixture(mentions_haystack)'
      where: 'item.contains($input.query) || $input.query.is_empty'
      bind: matches
    event: context.mention_search.results
    payload:
      matches: ${matches}
      query: '$input.query'
```

Fixtures: `@fixture(<name>)` reads from a static `MOCK_FIXTURES: HashMap<&str, &'static [&'static str]>` registered at compile time.

Filter expression grammar (minimal, deliberately tiny):

```
expr     := atom (op atom)?
atom     := identifier '.' method '(' arg? ')' | identifier | string
method   := 'contains' | 'is_empty' | 'starts_with' | 'eq'
op       := '||' | '&&'
identifier := 'item' | '$input.<key>'
```

Evaluator is ~80 lines of recursive-descent over String tokens. No general-purpose expression eval — reject anything outside the grammar.

### Why so restricted

The DSL must be auditable in CI. A general-purpose evaluator (Lua, Rhai, etc.) would inflate the trust boundary of mock-engine. Restricted grammar is enforceable by `codegen-mock-scenarios.mjs` validation.

### Tests

- `filter_grammar_rejects_unsupported_methods`
- `filter_grammar_supports_or_and_and`
- `filter_emits_full_haystack_on_empty_query`
- `filter_substring_matches_are_case_sensitive`

## Migration plan (per-handler order)

Once primitives land, port handlers from simplest to heaviest:

1. **`release.generate_notes`** — Linear timeline, no counters. Just `@hash_7` for note_id. Smallest port (~2h).
2. **`release.deploy`** — Linear timeline, uses `@hash_7(deploy_id)` + `@hash_7(commit_id)` + 4-step `deploy_progress` timeline. Mid-weight (~4h).
3. **`context.mention_search`** — Filter DSL only; no counter or ledger. Mid-weight (~4h).
4. **`handoff.create` / `handoff.approve`** — Both need multi-event ledger (`signers`, `required_signers`, `status`). Pair-port together (~6h).
5. **`handoff.dispatch_local`** — Branches on `executor.spawn_failed` vs `dispatch_ok`. Needs ledger + conditional (deferred — design conditionals in a follow-up if branching becomes common).
6. **`assessment.run`** — Heaviest. ~15-event evidence stream + verdict computation per-rubric. Needs all three primitives + possibly conditional branches.
7. **`message.submit`** — Largest tree. Defer until all above stabilise.

## Codegen impact

- `scripts/codegen-mock-scenarios.mjs` validates new fields (`state_seeds_after`, `filter_then_emit`) in input YAML.
- `tools/mock-engine/src/generated/scenario_catalog.rs` adds optional fields to `TimelineStep` + `RuntimeScenarioEntry`.
- `verify-codegen.sh` drift gate enforces shape; existing 21 scenarios pass without modification.
- Schema reference `schema/mock-scenario.schema.json` updated in lockstep.

## Acceptance criteria

- Three primitives implemented in `scenarios.rs` with unit tests.
- `tools/mock-engine/src/generated/scenario_catalog.rs` regenerated from extended schema; no drift.
- At least one previously-deferred handler (recommend `release.deploy`) ported to YAML and removed from `legacy_scenarios.rs`.
- `cargo test -p mock-engine` passes; `bash scripts/verify-codegen.sh` passes.
- Wave-summary records the port + remaining handler list shrinks by one.
- Architecture rule preserved: YAML carries metadata + minimal grammar; no general-purpose expression evaluator.

## Non-goals

- General-purpose conditional branching (`if/else`) in YAML. If a handler needs it, port stays in `legacy_scenarios.rs` until a dedicated conditional primitive design pass.
- Macros / template inheritance. Each scenario is self-contained.
- Cross-scenario state. Each scenario gets a fresh `State` via `mk_state` per dispatch.

## Open questions

1. Should `@hash_*` generators be deterministic across `State` instances (seed-only) or counter-stateful (incremental)? Current design says counter-stateful; replays reproduce sequences but only within a single `State` lifetime. For test reproducibility a seed-only `@hash_pure(seed)` variant may be useful as a follow-up.
2. Should `filter_then_emit` support multi-key fixtures (`Vec<HashMap<&str, &str>>`)? Initial design is `&[&str]` only. Extend if a handler needs structured fixture rows.
3. ADR or wave-summary mini-ADR for the filter DSL grammar boundary? Probably mini-ADR sufficient unless grammar grows.

## Implementation pointers

- All edits land in `tools/mock-engine/src/scenarios.rs` + `tools/mock-engine/src/generated/scenario_catalog.rs` + `scripts/codegen-mock-scenarios.mjs` + `schema/mock-scenario.schema.json`.
- Per-handler ports also touch `tools/mock-engine/src/legacy_scenarios.rs` (delete the arm + dead helper fns) and `tools/mock-engine/scenarios/<handler>.yaml` (new file).
- Regression suite: `cargo test -p mock-engine` + add 1-3 integration tests per port mirroring the existing pattern (`shell_start_runtime_dispatched_emits_started_output_and_response` is the template).
