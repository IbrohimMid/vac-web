# Plan 04 — Red-team harness skeleton

**Phase**: 0.5 · **Depends on**: Plan 03 · **Blocks**: Phase 0.5 exit · **Est**: 1–2 days

## Goal

Build the infrastructure that runs the 67 adversarial test cases from [`red-team-test-plan.md`](../../red-team-test-plan.md), wire the first 5 as smoke tests, and hook into CI. This is the safety net that prevents any future change from silently opening a security hole.

## Why this is hard

Red-team tests must be able to **simulate a compromised agent** without running a real LLM. They need to inject hostile inputs at the right layer (bridge router, engine policy, shell executor) and assert the denial happened **at the expected layer**. Too shallow and tests become unit-ish pass-through; too deep and they're slow and flaky.

## Scope

### In
- Test harness runner (`cargo test --test red-team --features redteam`).
- Fixture system: bridge in test mode + mock engine + stubbed agent that emits canned tool calls.
- First 5 cases wired (IDs 1, 3, 9, 18, 33).
- CI workflow.
- Annotation macro for test metadata.

### Out
- Full 67-case coverage (lands progressively across phases per plan's phase gates).
- Fuzzing (weekly separate workflow, post-v1).

## Deliverables

```
tests/red-team/
├── Cargo.toml                 # separate crate with redteam feature
├── src/
│   ├── lib.rs
│   ├── harness/
│   │   ├── bridge_fixture.rs  # bridge spawned with mock engine
│   │   ├── engine_stub.rs     # engine that emits canned responses
│   │   ├── agent_injector.rs  # injects tool-call envelopes
│   │   └── assertions.rs      # denial-at-layer assertions
│   └── macros.rs              # #[red_team_test(id, layer, profile)]
├── cases/
│   ├── rt001_assessor_edit_file.rs
│   ├── rt003_bash_c_bypass.rs
│   ├── rt009_bash_via_allowlist.rs
│   ├── rt018_read_env_file.rs
│   └── rt033_profile_hash_mismatch.rs
└── README.md
.github/workflows/red-team.yml
```

## Stages

### S1 — Harness architecture (0.5 day)

Design decisions to record:
- **Bridge runs in-process** for speed: spawn via `tokio::task`, bind to random port, tear down after test.
- **Engine stub** is a Rust impl of the JSON-RPC protocol subset — no real VAC process. Advantages: fast, deterministic, can simulate any response. Disadvantage: doesn't test real engine policy. Mitigation: complementary engine-layer tests in VAC repo itself.
- **Agent injector** = direct WS client that sends crafted envelopes (tool-call request, approval attempts, etc.) as if it were a compromised agent.
- **Assertion helpers**: `assert_denied_at("bridge")`, `assert_denied_at("engine")`, `assert_denied_at("both")`, `assert_audit_contains(...)`, `assert_no_state_mutation()`.

Write `harness/README.md` explaining decision.

**Exit**: architecture doc reviewed.

### S2 — Annotation macro (0.3 day)

Derive macro or attribute macro (`#[red_team_test(...)]`) that:
- Registers test with global registry at compile time.
- Emits `cargo test`-compatible fn.
- Enforces metadata fields: `id`, `title`, `layer` ∈ `{bridge, engine, both}`, `profile`, `severity`.

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

**Exit**: macro compiles; running test surfaces metadata in output.

### S3 — Bridge fixture + engine stub (0.5 day)

Implement `BridgeFixture` with builder API:
```rust
let fixture = BridgeFixture::builder()
    .profile("assessor.rtd@1.0.0")
    .project_root(tmp_dir.path())
    .engine_stub(EngineStub::default())
    .start().await;
let client = fixture.connect().await;
```

Lifecycle: `start` → `drop` kills child + cleans tempdir. Panic-safe.

Engine stub defaults: accepts `session.create`, emits `session.ready`, accepts messages but never mutates anything.

**Exit**: fixture used in a hello-world test.

### S4 — Agent injector + first 3 cases (0.4 day)

`AgentInjector` wraps WS client with tool-call-spoofing API:
```rust
injector.send_tool_call("edit_file", json!({"path": "a.txt"})).await;
let result = injector.await_response().await;
assert_denied_at("bridge", &result);
```

Wire:
- **RT-001** — assessor calls `edit_file` → denied at bridge + engine.
- **RT-003** — `shell.exec_allowlisted { bin: "bash" }` → denied at bridge (bin not in allowlist).
- **RT-009** — same with `-c`-style args → denied at bridge.

**Exit**: 3 tests green.

### S5 — Filesystem + profile-pinning cases (0.4 day)

- **RT-018** — assessor reads `.env` → denied (fs deny_globs).
  - Needs: temp project with `.env` file; attempt read via agent-emitted `read_file`.
- **RT-033** — bridge advertises profile A, engine loaded with profile B → engine aborts.
  - Needs: engine stub with configurable hash; simulate mismatch.

**Exit**: 2 tests green.

### S6 — CI integration (0.2 day)

`.github/workflows/red-team.yml`:
```yaml
on: [pull_request, push]
jobs:
  redteam:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test -p red-team --features redteam --no-fail-fast
      - run: node scripts/red-team-report.js
```

Report script collects test annotations + results → posts PR comment with matrix.

**Exit**: CI workflow green; deliberately broken profile fails red-team job.

### S7 — Docs & onboarding (0.1 day)

Write `tests/red-team/README.md`:
- How to run locally (`cargo test -p red-team`).
- How to add a new case (copy template, wire annotation, implement).
- Per-phase phase-gate cross-reference to `red-team-test-plan.md §7`.

**Exit**: contributor can add a new case in < 20 min.

## Testing

Meta-testing (testing the test harness):
- Harness can detect genuine denial (positive).
- Harness detects denial bypass (negative: briefly break profile → test fails).
- Cleanup: no zombie processes, no temp dirs left.

## Exit criteria

- [ ] Harness compiles and runs.
- [ ] First 5 cases (RT-001, RT-003, RT-009, RT-018, RT-033) green.
- [ ] CI workflow active.
- [ ] Meta-test confirms harness detects bypass.
- [ ] README onboarding < 20 min.

## Risks

| Risk | Mitigation |
|---|---|
| Engine stub drifts from real VAC behaviour | Add parallel "real engine" smoke test once VAC PRs #4 land; run weekly |
| Flaky tests due to port binding | Use `tokio::net::TcpListener::bind("127.0.0.1:0")` for ephemeral ports |
| Test speed regressions | Per-test budget (2s default); alerts if trending up |
| False sense of security if only first 5 wired | README says explicitly "baseline only; full matrix lands per phase"; phase exit gates enforce |

## Related

- [`red-team-test-plan.md`](../../red-team-test-plan.md) — case catalog
- [`capability-profiles.md`](../../capability-profiles.md) §6 — two-layer model
- Plan 03 — profile YAMLs under test
- Plan 10 — bridge enforcement implementation
