---
id: wiring.section_a_resolver_extensions
title: 'Section A resolver extensions for mock-engine YAML scenarios'
priority: P2
area: tooling
owners:
  - mock-engine
  - bridge
status: landed  # Pass #37 complete (Section A 8/8) on 2026-05-05; doc retained for design context
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Section A resolver extensions for mock-engine YAML scenarios

> **Current head note (Pass #37 complete, 2026-05-05):** Section A is **8 of 8 complete** as of Pass #37 (`message.submit` ported via `@message_submit_branch` + `@message_submit_outcome` generators on top of `payload_template_json` + `condition` + `foreach` + `state_seeds_after` primitives — no new primitives, per the post-Pass-#36 audit-fixup mandate). All Section A handlers now live in YAML scenarios; `legacy_scenarios.rs` retains only the dispatch-fallthrough router + `is_handoff_execution_submit` helper (exposed `pub(crate)` for the message-submit branch generators). Post-Pass-#36 audit fixups remain in effect: outer-foreach `condition` gating via the shared `condition_matches` helper, and the codegen per-step schema firewall (`event` / `after_ms` / `payload` / `payload_template` / `state_seeds_after` + `payload` ⊕ `payload_template` mutex).

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

## Primitive 4 — Conditional skip primitive (Pass #34, single-equality)

### Why

`handoff.dispatch_local` branches on operator input into success/failure event sequences sharing only the initial `started` emit. Without a conditional primitive, branching ports stay imperative or duplicate common-prefix steps across two YAML files — neither acceptable.

Pass #28 originally listed conditional branching as a Non-goal pending a dedicated design pass. Pass #34 promotes it with a deliberately minimal contract: single-equality only, no expression engine.

### Spec

Optional `condition: { binding, equals }` field on each timeline step. Both keys required, both string-typed. Codegen rejects extra keys or non-string values.

### Dispatch semantics

In `try_runtime_dispatch`, before rendering each step:

```rust
if let Some(cond) = step.condition {
    let actual = bindings.get(cond.binding).map(String::as_str).unwrap_or("");
    if actual != cond.equals { continue; }
}
```

Skipped steps emit no event and do not run their `state_seeds_after`. Bindings remain unchanged across a skip. Unset (or non-string) bindings compare against the empty string — an unset binding never satisfies a non-empty `equals` clause.

### Codegen impact

`scenario_catalog.rs` `RuntimeTimelineStep` gains an optional field:

```rust
pub condition: Option<RuntimeStepCondition>,

pub struct RuntimeStepCondition {
    pub binding: &'static str,
    pub equals: &'static str,
}
```

Default `None` for the 25 prior runtime-dispatched scenarios — no behaviour change.

`scripts/codegen-mock-scenarios.mjs` validates the YAML `condition` block: must be an object with exactly the keys `binding` and `equals`, both string-typed. Any other shape errors out at codegen time.

### YAML example (handoff.dispatch_local)

```yaml
state_seeds:
  pid: '$input.packet_id'
  exec_sid: '@executor_session_id'
  branch: '@handoff_dispatch_outcome'
timeline:
  - event: handoff.execution_progress       # common prefix, no condition
    payload_template: '{"packet_id":"${pid}","executor_session_id":"${exec_sid}","status":"started"}'
  - event: handoff.completed
    condition: { binding: branch, equals: success }
    payload_template: '{"packet_id":"${pid}","executor_session_id":"${exec_sid}","status":"completed"}'
  - event: handoff.failed
    condition: { binding: branch, equals: failure }
    payload_template: '{"packet_id":"${pid}","reason":"executor_failed"}'
```

`@handoff_dispatch_outcome` reads `params.force_failure: bool` and the `params.mode == "fail"` alias; returns `success` or `failure`. Branch decided once at scenario start and captured in the `branch` binding.

### Why so restricted

1. **Audit boundary** — single-equality is grep-decidable. A general-purpose grammar (boolean operators, nested expressions, function calls) makes the YAML control plane Turing-equivalent in practice.
2. **Source-of-truth invariant** — the Rust runtime decides the *outcome* (via `@handoff_dispatch_outcome` generator); YAML only decides the *order and skip-set* of pre-declared events given that outcome. Adding `&&` or function calls would let YAML compute its own outcomes, which inverts the boundary.
3. **Force a design pass for richer needs** — the next handler that genuinely needs `not_equals` or boolean composition triggers a fresh design pass and a separate primitive (not an ad-hoc extension to this one). Same anti-creep policy Pass #28 applies to the filter DSL grammar.

### Generator naming for branch outcomes

Pass #34 introduces `@handoff_dispatch_outcome` (domain-specific) rather than a generic `@dispatch_outcome` or `@branch`. Rationale:

- Domain-specific names make the audit trail clearer: `grep handoff_dispatch_outcome` finds exactly the handlers that branch on dispatch outcome.
- Generic primitives drift toward mini expression engines as soon as a second handler reuses them with slightly different semantics.
- Future per-handler outcome generators follow the same pattern: `@assessment_run_outcome` (verdict computation in `assessment.run`), `@message_submit_packet_kind` (packet-detection branching in `message.submit`), etc.

### Tests

- `handoff_dispatch_local_runtime_dispatch_success_branch_emits_full_progress_completed_upserted` — default params; expects 4 events + final response.
- `handoff_dispatch_local_runtime_dispatch_failure_branch_via_force_failure_param` — `force_failure: true`; expects 3 events + final response.
- `handoff_dispatch_local_failure_branch_via_mode_fail_alias` — `mode: "fail"`; verifies first non-progress event is `handoff.failed`.

## Primitive 5 — foreach loop over JSON-array binding (Pass #35, single-level)

### Why

`assessment.run` emits a per-rubric event stream (~12 evidence rows + per-row identity hashes) where the count and content come from a Rust-owned family catalog. Without a foreach primitive, porting this handler requires either (a) hand-unrolling 12 near-identical timeline steps in YAML (loses the catalog as the source of truth) or (b) keeping the imperative handler. Neither is acceptable.

Pass #28 originally listed bounded looping as a Non-goal pending a dedicated design pass. Pass #35 promotes it with a deliberately minimal contract: iterate a JSON-array binding, expose item fields + 0-based index, no break/continue, no nested foreach, no expression engine.

### Spec

A timeline step may be either a regular emit step (existing) **or** a foreach step. A foreach step has the shape:

```yaml
- foreach:
    binding: <name>           # required: name of a string binding holding a JSON-encoded array
    as: <prefix>              # required: prefix used for per-iter object-field bindings
    index_var: <name>         # optional: name for the 0-based loop index binding
  body:
    - event: ...              # one or more body steps; same shape as a regular timeline step
      payload_template: ...
      condition: { ... }      # Primitive 4 still works inside body
```

A step that sets `foreach` **must not** also set `event`. Body steps **must not** themselves contain `foreach` — single-level iteration only. Codegen rejects both shapes.

### Dispatch semantics

In `try_runtime_dispatch`, when a step has `foreach: Some(...)`:

1. Read `bindings[foreach.binding]` as a string and `serde_json::from_str` it into a `Value`. If parsing fails or the result is not `Value::Array`, treat as empty array (no body emissions, no error — graceful no-op).
2. For each `(idx, item)` in the array (`item: &Value`):
   - Clone the outer bindings into `iter_bindings` (per-iter scope; outer bindings are not mutated).
   - If `index_var` is non-empty, insert `{index_var: idx.to_string()}`.
   - If `item` is `Value::Object(obj)`, for each `(k, v)` insert `{format!("{as_prefix}.{k}")}: <v as string>` (string fields verbatim, other types via `serde_json::to_string`).
   - For each `body_step` in `foreach.body`, call `emit_single_step(body_step, &mut iter_bindings, ...)` — which honors Primitive 4 conditions and Primitive 2 `state_seeds_after` exactly as on regular steps.
3. After the loop, drop `iter_bindings` and resume with the original `bindings`. Persistent counter bumps still flow through `state` (generators read/write `state` directly, not `bindings`).

No break, no continue, no early exit. The body always runs once per item in declaration order; condition-skipped body steps still consume their iteration slot.

### Codegen impact

`scenario_catalog.rs` `RuntimeTimelineStep` gains an optional field:

```rust
pub foreach: Option<RuntimeForeach>,

pub struct RuntimeForeach {
    pub binding: &'static str,
    pub as_prefix: &'static str,
    pub index_var: &'static str, // empty when YAML omits index_var
    pub body: &'static [RuntimeTimelineStep],
}
```

Default `None` for the 26 prior runtime-dispatched scenarios — no behaviour change. When `Some`, the step's `event`/`payload_json`/`condition`/`state_seeds_after` are ignored at dispatch (all set to empty/None by the codegen for foreach steps).

`scripts/codegen-mock-scenarios.mjs` validates the YAML `foreach` block:

- `foreach` must be an object with keys ⊆ `{binding, as, index_var}`; `binding` and `as` required and string-typed; `index_var` optional and string-typed.
- Step must NOT also set `event` — `event` and `foreach` are mutually exclusive.
- Sibling `body` must be an array of step objects.
- Each body step must have a string `event`. No body step may itself set `foreach` (codegen errors out — single-level only).

`SCENARIO_CATALOG.timeline_events` flattens foreach body event names so the metadata catalog still surfaces the actual event surface for any audit grep.

### YAML example (debug-foreach-smoke, the Pass #35 canary)

```yaml
state_seeds:
  items: '@debug_smoke_items'           # generator returns a JSON-array string
timeline:
  - foreach:
      binding: items
      as: item
      index_var: idx
    body:
      - event: debug.smoke_item
        payload_template: '{"index":${idx},"label":"${item.label}","kind":"${item.kind}"}'
      - event: debug.smoke_skipped
        condition: { binding: item.skip, equals: "true" }
        payload_template: '{"index":${idx},"reason":"${item.skip_reason}"}'
```

`@debug_smoke_items` is a Rust-owned generator returning three fixed objects (alpha/beta/gamma). The body emits one `debug.smoke_item` per iteration plus an extra `debug.smoke_skipped` only when `item.skip == "true"` (beta only). Real handlers will use domain-specific generators (e.g. `@assessment_family_catalog`) that build their array from Rust-side static data.

### Why so restricted

1. **Audit boundary** — single-level + no break/continue keeps every iteration grep-decidable: count the body steps × items in the bound array. A nested or early-exit form would let YAML compute its own emission count from inside the loop, inverting the source-of-truth boundary.
2. **Source-of-truth invariant** — Rust generators decide the array contents (12 swarms for `@assessment_family_catalog`, 3 fixtures for `@debug_smoke_items`); YAML only decides the per-iter event template. Adding `if/break` would let YAML mutate iteration count or order, which the boundary forbids.
3. **Force a design pass for richer needs** — the next handler that genuinely needs nested loops, break, or continue triggers a fresh design pass and a separate primitive (not an ad-hoc extension to this one). Same anti-creep policy as Primitives 3 and 4.

### Per-iter binding format

- Object fields: `{as_prefix}.{key}` for each top-level field on the JSON object (e.g. `item.label`, `item.kind`).
- Index: `{index_var}` (e.g. `idx`) holds the 0-based iteration index as a string.
- Outer bindings remain visible during body execution (per-iter is an extension, not a replacement).
- Per-iter bindings vanish after the loop closes — subsequent timeline steps cannot reference `item.*` or `idx`.
- `state_seeds_after` on body steps writes into the **per-iter** scope; subsequent body steps in the same iteration see the addition, but the next iteration starts from a fresh clone of the outer bindings.

### Tests

- `runtime_foreach_smoke_scenario_present_in_catalog` — catalog-shape assertion: confirms codegen emitted the foreach step with `binding=items`, `as_prefix=item`, `index_var=idx`, body length 2, and that body steps cannot themselves contain foreach.
- `runtime_foreach_smoke_emits_per_item_with_resolved_bindings_and_condition` — end-to-end smoke: dispatches `debug.foreach_smoke`, asserts the 3-item array yields 4 notifications (3 smoke_item + 1 smoke_skipped only on beta) + 1 final response, with `${item.field}` and `${idx}` resolved per iteration.

### Pass #35 split rationale

The original Section A roadmap slated `assessment.run` for Pass #35 as the foreach primitive's first user. To keep the audit blast radius small, Pass #35 lands the primitive + smoke canary only; Pass #36 layers the actual `assessment.run` port (12-swarm family catalog, 3 early-failure paths, verdict computation) on top of identical foreach semantics. Splitting also preserves a clean revert window — if Pass #36 hits an unexpected legacy edge case, Pass #35 stays landed and the primitive remains validated by the smoke scenario.

## Pass #36 — assessment.run port (Primitive 5 first real user)

### Scope

Port `handle_assessment_run` (~291 lines, 12-swarm family catalog + 3 early-failure paths + verdict computation + RTD gate pair) from `legacy_scenarios.rs` to `tools/mock-engine/scenarios/assessment-run.yaml` + 14 new generators in `scenarios.rs::eval_seed_value`. Section A progress: **7 / 8 ported**.

### Generators introduced (14)

- `@assessment_run_id` — counter-bumping run id matching legacy `run_01J{seed%10000:0>20}{counter:0>3}`. **MUST** be the first state_seed in the YAML so the bump precedes `@assessment_connector_snapshots_json` reading `state.counter`.
- `@assessment_is_failure` — returns `"true"` for the three failure swarms (`schema_version_unsupported`, `candidate_schema_invalid`, `redaction_applied`), else `"false"`. Drives the YAML `condition` primitive that selects the failure path vs. the success path.
- `@assessment_family_catalog` — builds a JSON-array string of objects from `legacy_scenarios::family_catalog(swarm)` for the foreach primitive. Each item bakes per-iter binding fields (`name`, `is_skip`, `is_first_finding`) consumed by inner condition primitives, plus pre-rendered candidate JSON strings (`candidate_json`, `bad_candidate_json`) spliced into payload templates via `${agent.candidate_json}`. Failure swarms return `"[]"` so the foreach is a graceful no-op.
- `@assessment_family_size` — number of agents in the family (or 0 for failure swarms). Used as the `total_checks` in `assessment.started`.
- `@assessment_scope_json` — calls the now-`pub(crate)` `legacy_scenarios::repo_context` so git introspection still flows when `state.project` is set. Wire-byte deviation #2 (kept for zero-deviation Pass #36; future drop would lose `repo_ref` / `base_commit_sha` git introspection).
- `@assessment_connector_snapshots_json` — reads `state.counter` POST-bump (after `@assessment_run_id` ran).
- `@assessment_failure_rejected_inner_json` + `@assessment_failure_failed_inner_json` — inner-JSON pattern (no outer braces). YAML wraps via `{"run_id":"${run_id}",${rejected_inner_json}}` because `render_string` is single-pass and embedding `${run_id}` literal in the generator output would not be re-substituted on render.
- `@assessment_verdict` / `@assessment_release_score` / `@assessment_rtd_state` / `@assessment_rtd_summary` / `@assessment_rtd_satisfied` / `@assessment_rtd_blockers_json` — derived from `assessment_verdict_for_swarm` helper (warn when `total_findings >= 3`, else pass). Failure swarms return `"pass"` but the success-only events are condition-skipped.

### Wire-byte deviations (acknowledged + audited)

1. **Response ordering on failure path**: legacy emitted `started → response → worker_output_rejected → failed`. YAML port emits `started → worker_output_rejected → failed → response`. Uniform response-last via `final_response` simplifies the runtime dispatch surface; any cockpit/local-bridge assertion that relied on response-mid was deemed a test smell. No production surface assert was hit.
2. **`repo_context` coupling kept**: `@assessment_scope_json` calls `crate::legacy_scenarios::repo_context` the same way legacy did. `family_catalog`, `repo_context`, and `RepoContext` (with all fields) are now `pub(crate)` to enable this without code duplication.

### Inner-JSON pattern (Pass #36 wire constraint)

`scenarios::render_string` substitutes `${var}` placeholders in a single pass: a generator returning `${other_var}` literal will NOT be re-substituted. To work around this for failure payloads that need `${run_id}` interpolated INSIDE the generator's JSON object, the generator returns the JSON object body **without outer braces** (strip leading `{` + trailing `}` from `json!(...).to_string()`), and the YAML wraps the result in `{"run_id":"${run_id}",${...inner_json}}`. The first-pass render now substitutes both `${run_id}` and `${...inner_json}` simultaneously into a valid JSON object.

### Tests added (5)

- `assessment_run_default_rtd_swarm_emits_full_pipeline` — default RTD (no swarm param). 5 agents incl. `release_gate` skip; verdict `warn` (4 findings >= 3); 16-line layout asserted index-by-index.
- `assessment_run_frontend_swarm_emits_per_iter_findings` — frontend swarm (5 agents incl. trailing synthesizer skip); same 16 lines, verdict `warn`, sub-asserts on per-iter binding resolution (`${agent.name}`, `${agent.candidate_json}`).
- `assessment_run_schema_version_unsupported_emits_failure_pipeline` — 4-line failure layout; asserts wire-byte deviation #1 (response is terminal); validates `total_checks=0` from empty family.
- `assessment_run_candidate_schema_invalid_emits_failure_pipeline` — same 4-line shape with the `candidate_missing_title` code + `candidates[0].title` path.
- `assessment_run_redaction_applied_emits_failure_pipeline` — same 4-line shape with `sample_reason: "redaction_applied"` distinct field.

## Migration plan (per-handler order)

Once primitives land, port handlers from simplest to heaviest:

1. **`release.generate_notes`** — Linear timeline, no counters. Just `@hash_7` for note_id. Smallest port (~2h).
2. **`release.deploy`** — Linear timeline, uses `@hash_7(deploy_id)` + `@hash_7(commit_id)` + 4-step `deploy_progress` timeline. Mid-weight (~4h).
3. **`context.mention_search`** — Filter DSL only; no counter or ledger. Mid-weight (~4h).
4. **`handoff.create` / `handoff.approve`** — Both need multi-event ledger (`signers`, `required_signers`, `status`). Pair-port together (~6h).
5. **`handoff.dispatch_local`** — Branches on `executor.spawn_failed` vs `dispatch_ok`. Needs ledger + conditional (deferred — design conditionals in a follow-up if branching becomes common).
6. **`assessment.run`** — Heaviest. ~15-event evidence stream + verdict computation per-rubric. Needs all three primitives + possibly conditional branches. **✅ Ported in Pass #36** via foreach over `@assessment_family_catalog` + condition primitive on `is_failure` binding (Section A: 7 / 8).
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

- Rich conditional grammar (`if/else`, `not_equals`, `equals_any`, `&&`, `||`, function calls, nested expressions) and rich loop grammar (nested foreach, `break`, `continue`, while-loops, range expressions) in YAML. Pass #34 introduced **Primitive 4** (above) and Pass #35 introduced **Primitive 5** (foreach loop over JSON-array binding, single-level, no break/continue) — both deliberately minimal as a deliberately minimal single-equality skip primitive (`condition: { binding, equals }`) — sufficient for `handoff.dispatch_local`. Anything richer triggers a fresh design pass and a separate primitive, never an ad-hoc grammar extension.
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
