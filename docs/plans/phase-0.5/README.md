# Phase 0.5 — Red-Team Harness + Upstream Alignment

**Duration**: 3–4 days
**Position**: after Phase 0.4 codegen; before Phase 1 bridge implementation
**Status**: 🟡 **PROFILE-LAYER DONE; BRIDGE + UPSTREAM PENDING** — 10 red-team tests passing (5 mandatory RT-001/003/009/018/033 + 5 extension cases) exercising `profile-core` enforcement directly. Bridge/engine/agent-injector harness deferred to Phase 1 Plan 07–10 when those components exist. Upstream VAC PRs (#1–#5) deferred: requires access to `vastar-agentic-cli` repo + review cycle.

> This sub-phase was previously folded into a broader "Phase 0.5." With the split into 0.1–0.5, this file is now the narrow sub-phase covering what the others don't: adversarial testing scaffold + upstream VAC PR coordination.

## Goal

Two things that together close the gate to Phase 1 implementation:
1. **Red-team harness** — test infrastructure that simulates a compromised agent at the bridge layer, wiring the first 5 cases (RT-001, RT-003, RT-009, RT-018, RT-033) as smoke proof.
2. **Upstream VAC PRs** — draft (and ideally merge) the foundational PRs to `vastar-agentic-cli` that Phase 1 depends on: `side_effect` tagging, `vac schema dump`, `CapabilityProfile` loader, `shell.exec_allowlisted`, `vac serve --stdio`.

Without these, Phase 1 has nothing to bridge to.

## Entry criteria

- Phase 0.4 codegen produces real TS + Rust types (not stubs).
- `cargo build --workspace` green.
- Access to `vastar-agentic-cli` repo.

## Scope

### In
- Red-team harness skeleton with annotation macro + fixture builder.
- First 5 red-team cases wired as smoke tests.
- `.github/workflows/red-team.yml` activated.
- Upstream VAC PRs drafted: #2, #3, #4, #5, #1 (in dependency order).
- Hash handshake protocol documented.

### Out
- Remaining 62 red-team cases (land per phase gate).
- Upstream VAC PRs #6, #7, #8, #9, #10 (drafts only; full impl in later phases).

## Stages

### S1 — Red-team harness architecture (0.5 day)

Design decisions to lock in `tests/red-team/src/harness/README.md`:

- **In-process bridge fixture**: spawn via `tokio::task`; random port; teardown via Drop.
- **Engine stub**: Rust impl of JSON-RPC subset — no real VAC process. Complements real-engine tests that live in VAC itself.
- **Agent injector**: direct WS client sending crafted envelopes (tool-call requests, approval attempts, etc.).
- **Assertion helpers**: `assert_denied_at("bridge")`, `assert_denied_at("engine")`, `assert_audit_contains(...)`, `assert_no_state_mutation()`.

Document the three-layer test model: bridge alone, engine alone, both (defense-in-depth).

**Exit**: architecture doc reviewed; skeleton types compile.

### S2 — Annotation macro (0.3 day)

`tests/red-team/src/macros.rs`:
```rust
#[red_team_test(
    id = "RT-001",
    title = "assessor edit_file denied",
    layer = "both",
    profile = "assessor.rtd@1.0.0",
    severity = "critical",
)]
fn denies_edit_file_in_assessor() { ... }
```

Implementation options:
- Attribute macro (`proc-macro-attribute`) that registers test + generates `#[tokio::test]`.
- Simple declarative: `red_team_test!(id="RT-001", ...);` macro_rules.

Either works. Decide in Stage based on simplicity.

Metadata collected for reporting in `scripts/red-team-report.sh` (post-S6).

**Exit**: macro compiles; `cargo test -p red-team --features redteam` surfaces annotation in output.

### S3 — Bridge fixture + engine stub (0.5 day)

`tests/red-team/src/harness/bridge_fixture.rs`:

```rust
pub struct BridgeFixture {
    pub base_url: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    _tmpdir: TempDir,
}
impl BridgeFixture {
    pub async fn builder() -> FixtureBuilder { ... }
    pub async fn connect(&self) -> TestClient { ... }
}
pub struct FixtureBuilder { ... }
impl FixtureBuilder {
    pub fn profile(mut self, id: &str) -> Self;
    pub fn project_root(mut self, p: &Path) -> Self;
    pub fn engine_stub(mut self, s: EngineStub) -> Self;
    pub async fn start(self) -> BridgeFixture;
}
```

Drop impl tears down: shutdown signal → join task → delete tmpdir → kill any child. Panic-safe.

`engine_stub.rs`: default accepts `session.create`, replies `session.ready`, accepts messages without mutating.

**Exit**: fixture used in a hello-world test.

### S4 — Agent injector + first 3 cases (0.5 day)

`tests/red-team/src/harness/agent_injector.rs`:

```rust
pub struct AgentInjector { ws: WsClient }
impl AgentInjector {
    pub async fn send_tool_call(&mut self, tool: &str, args: Value) -> ToolCallResult;
    pub async fn await_response(&mut self) -> Response;
}
```

Wire:
- **RT-001** — assessor `edit_file` → both layers deny.
- **RT-003** — `shell.exec_allowlisted { bin: "bash" }` → bridge deny.
- **RT-009** — same with `-c` style args → bridge deny.

Each test ≤ 60 lines; assertion-heavy.

**Exit**: 3 tests green; deliberate bypass attempt fails.

### S5 — Remaining 2 smoke cases (0.3 day)

- **RT-018** — assessor reads `.env` → fs deny_globs.
- **RT-033** — profile hash mismatch → engine abort (uses stub to simulate mismatch).

**Exit**: 5 tests green.

### S6 — CI integration (0.2 day)

`.github/workflows/red-team.yml` already exists; verify:
- Runs on every PR + push to main.
- Uses rust-cache.
- Fails loud on any test failure.

Add `scripts/red-team-report.sh` to collect test annotations → PR comment formatter.

**Exit**: CI workflow exercised on a PR (real or synthetic).

### S7 — Onboarding docs (0.1 day)

`tests/red-team/README.md` expanded:
- How to run locally.
- How to add a new case (copy template, wire annotation, implement).
- Phase-gate cross-reference to `red-team-test-plan.md §7`.

**Exit**: contributor can add a new case in < 20 min.

### S8 — Upstream VAC PR #2: `side_effect` tagging (0.5 day)

In `vastar-agentic-cli` repo:
1. Add `SideEffect` enum in `vac_core::tool::meta`.
2. Extend `ToolMeta` struct.
3. Tag every existing tool (grep `impl Tool for`).
4. Compile-time check: tool without tag → build fails (trait method without default).
5. Unit test: iterate registry, assert every tool tagged.

**Exit**: PR open; CI in VAC repo green.

### S9 — Upstream VAC PR #3: `vac schema dump` (0.3 day)

1. Depend on `schemars`.
2. Add CLI subcommand `vac schema dump --out <dir>`.
3. Emit schemas matching `packages/protocol/v1/` (key fields parity).
4. Integration test dumping + comparing to our committed schemas.

**Exit**: PR open.

### S10 — Upstream VAC PR #4: profile loader + policy (1 day)

Most substantial:
1. `CapabilityProfile` struct per schema.
2. YAML loader with schema validation.
3. Copy/symlink profile assets from `vac-web/packages/protocol/v1/profiles/`.
4. Engine startup accepts `--profile <id@version>`.
5. Tool registry filter at load.
6. Invocation guard.
7. Handshake hook for hash pin.

Tests: profile load, filter, denial, hash mismatch.

**Exit**: PR open; hand-run `vac interactive --profile assessor.rtd@1.0.0` shows reduced tool surface.

### S11 — Upstream VAC PR #5: `shell.exec_allowlisted` (0.3 day)

New tool per [`docs/plans/phase-0.5/06-upstream-vac-prs.md §6`](./06-upstream-vac-prs.md).

**Exit**: PR open.

### S12 — Upstream VAC PR #1: `vac serve --stdio` (0.7 day)

New binary target / subcommand. Line-delimited JSON-RPC. No wrapping of legacy `runner.rs`.

**Exit**: PR open; smoke test with `tests/red-team/` bridge fixture works end-to-end.

### S13 — Draft later PRs (0.3 day)

PRs #6, #7, #8, #9, #10: description + proposed shape, draft state, no impl. Let upstream reviewers comment early.

**Exit**: 5 draft PRs/issues open.

## Deliverables

```
tests/red-team/
├── Cargo.toml                            ✅ (stub)
├── src/
│   ├── lib.rs                            ✅
│   ├── macros.rs                         ⏳
│   └── harness/
│       ├── mod.rs                        ✅
│       ├── bridge_fixture.rs             ⏳
│       ├── engine_stub.rs                ⏳
│       ├── agent_injector.rs             ⏳
│       └── assertions.rs                 ⏳
├── cases/
│   ├── rt001_assessor_edit_file.rs       ⏳
│   ├── rt003_shell_bash_bin.rs           ⏳
│   ├── rt009_shell_bash_c_args.rs        ⏳
│   ├── rt018_read_env_file.rs            ⏳
│   └── rt033_profile_hash_mismatch.rs    ⏳
├── tests/red_team.rs                     ✅ (placeholder)
└── README.md                             ✅ (stub)

scripts/red-team-report.sh                ⏳

# Upstream VAC repo (separate) ⏳
PR #2 side_effect tagging
PR #3 vac schema dump
PR #4 profile loader + policy
PR #5 shell.exec_allowlisted
PR #1 vac serve --stdio
Drafts: #6 evidence.capture, #7 finding.emit + AssessmentRun, #8 worktree_digest, #9 SessionSnapshot fields, #10 TeleportToken
```

## Exit criteria (gate to Phase 1)

- [ ] Harness compiles; `cargo test -p red-team --features redteam` runs.
- [ ] RT-001, RT-003, RT-009, RT-018, RT-033 pass.
- [ ] Meta-test confirms harness detects bypass (break a profile deliberately → test fails).
- [ ] CI red-team workflow green.
- [ ] Upstream PRs #2, #3 merged.
- [ ] Upstream PRs #4, #5, #1 open + in review.
- [ ] PRs #6–#10 drafted for later.

## Current state

**Completed** in scaffold turn:
- `tests/red-team/` directory structure.
- `Cargo.toml` with feature-gated test target.
- Placeholder test passing (`cargo test -p red-team --features redteam`).

**Remaining** for Phase 0.5 completion:
- All actual harness code (stages S1–S7).
- All upstream VAC PRs (stages S8–S13).

Estimated: 3–4 days of focused work + VAC upstream review cycle time.

## Risks

| Risk | Mitigation |
|---|---|
| Engine stub drifts from real VAC behaviour | Parallel real-engine smoke test once PR #4 merges; weekly cross-check |
| Flaky tests due to port binding | `TcpListener::bind("127.0.0.1:0")` for ephemeral ports |
| Upstream reviewer slow | Draft early; pair-review; small PR surface |
| PR #4 too large | Split into: loader (no enforcement), enforcement filter, handshake — three sub-PRs |
| Only 5 red-team cases = false safety | README explicit: "baseline only; full matrix lands per phase exit" |

## Day-by-day

### Day 1 — Harness foundation
- S1: architecture doc.
- S2: annotation macro.
- S3: bridge fixture + engine stub.

### Day 2 — First cases + CI
- S4: RT-001, RT-003, RT-009.
- S5: RT-018, RT-033.
- S6: CI verified.
- S7: onboarding docs.

### Day 3–4 — Upstream PRs (parallel if multiple contributors)
- S8: PR #2 side_effect tagging.
- S9: PR #3 schema dump.
- S10: PR #4 profile loader.
- S11: PR #5 shell.exec_allowlisted.
- S12: PR #1 vac serve.
- S13: drafts.

## Related

- [`docs/plans/phase-0.5/04-red-team-harness.md`](./04-red-team-harness.md) — granular harness plan.
- [`docs/plans/phase-0.5/06-upstream-vac-prs.md`](./06-upstream-vac-prs.md) — granular upstream PR plan.
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — full case matrix.
- [`docs/upstream-vac-prs.md`](../../upstream-vac-prs.md) — authoritative PR specs.

## Handoff to Phase 1

Phase 1 (bridge + `vac serve`) requires:
- Red-team harness working so Plan 10's profile enforcement has a test target from day one.
- Upstream PRs #2, #3, #4 merged so bridge can spawn `vac serve --stdio --profile <id>` and profile hash handshake works.

Ship this sub-phase + those upstream merges → Phase 1 can start cleanly.
