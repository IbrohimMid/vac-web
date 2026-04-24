# Red-team tests

Adversarial test suite for `vac-web`. Enforces that the assessor/executor boundary cannot be bypassed.

- Runner: `cargo test -p red-team --features redteam`.
- Matrix: [`docs/red-team-test-plan.md`](../../docs/red-team-test-plan.md).
- Plan: [`docs/plans/phase-0.5/04-red-team-harness.md`](../../docs/plans/phase-0.5/04-red-team-harness.md).

## Current coverage

**10 cases passing** at the profile-enforcement layer (via `profile-core`):

| ID | Title | Layer |
|---|---|---|
| RT-001 | assessor `edit_file` denied | Both |
| RT-003 | `shell.exec_allowlisted` bash bin denied | Bridge |
| RT-009 | shell injection args (semicolons, backticks, pipes, `-exec`) denied | Bridge |
| RT-018 | assessor reads `.env*` denied by `deny_globs` | Both |
| RT-033 | profile hash mismatch detected | Engine |
| ext-1 | assessor cannot invoke `connector.write.*` | Bridge |
| ext-2 | `executor.code` cannot `git_push` / `deploy.*` / `publish.*` | Bridge |
| ext-3 | `executor.release` cannot write `src/**` | Bridge |
| ext-4 | assessor egress constrained to family hosts + methods (GET only) | Bridge |
| ext-5 | `harness_summary` — metadata sanity |

## Expanding coverage

Phase 1 Plan 07-10 will add:
- `BridgeFixture` — spawns in-process axum server + mock engine for full stack tests.
- `AgentInjector` — crafted WS envelopes to simulate compromised agent.
- Cross-layer assertions (`assert_denied_at("bridge")` / `"engine"` / `"both"`).

Remaining 57 cases land per phase gate per `docs/red-team-test-plan.md §7`.

## Adding a case

1. Pick an ID from `docs/red-team-test-plan.md §3`.
2. Copy an existing `rt_*` test in `tests/red_team.rs` as template.
3. Attach `TestCaseMeta` constant with id/title/layer/profile/severity.
4. Assert denial via `profile_core::enforce::*` (or future `BridgeFixture`).
5. Run `cargo test -p red-team --features redteam`.

Feature flag `redteam` guards the test binary so `cargo test` default path stays fast.
