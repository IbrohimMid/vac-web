# Plan 06 — Upstream VAC PRs coordination

**Phase**: 0.5 · **Depends on**: Plan 01, 03 · **Blocks**: Phase 1 · **Est**: 2–3 days for drafting; merge cadence is upstream-dependent

## Goal

Draft the foundational upstream PRs to `vastar-agentic-cli` so Phase 1 bridge work has the engine-side contract to plug into. Land order is critical because later PRs depend on earlier ones.

## Why this is hard

These PRs span a repo we don't own exclusively. They must be small, additive, and not disturb existing TUI functionality. Reviewers need to understand why each is required — so PR descriptions must cross-reference this repo's blueprint.

## Scope

Draft (not necessarily merge) these PRs in `vastar-agentic-cli`:

- **PR #2** — Tool `side_effect` tagging (blocks everything).
- **PR #3** — `vac schema dump`.
- **PR #4** — `CapabilityProfile` loader + engine policy.
- **PR #5** — `shell.exec_allowlisted` tool.
- **PR #1** — `vac serve --stdio`.

Later phases (draft-only now): PR #6 (evidence.capture), #7 (finding.emit + AssessmentRun), #8 (worktree_digest), #9 (SessionSnapshot fields), #10 (TeleportToken).

## Stages

### S1 — Working branch + PR template (0.2 day)

In `vastar-agentic-cli`:
- Branch `vac-web-prep` as umbrella (or just one branch per PR).
- PR description template:
```
Part of vac-web initiative (../vac-web/docs/upstream-vac-prs.md#pr-N).
Motivation: <brief>.
Blast radius: <tables impacted>.
Breaking: <yes/no>.
Test coverage: <added>.
```

**Exit**: template reviewed with a VAC maintainer (if applicable).

### S2 — PR #2: `side_effect` tagging (0.5 day)

Per [`upstream-vac-prs.md §3`](../../upstream-vac-prs.md#3-pr-2--tool-side_effect-tagging):

1. Add `SideEffect` enum in `vac_core/src/tool/meta.rs`.
2. Extend `ToolMeta` struct to include `side_effect: SideEffect`.
3. Tag every existing tool (grep `impl Tool for` and go).
4. Add compile-time check (`#[must_use]` or trait with default that panics on register).
5. Unit test: iterate registry, assert every tool has tag.

Sub-PRs if repo-convention prefers: one per 10 tools.

**Exit**: CI green; `cargo test tool::tagging` passes.

### S3 — PR #3: `vac schema dump` (0.3 day)

1. Depend on `schemars` (or alternative) for Rust type → JSON Schema.
2. Add CLI subcommand in `vac_cli/src/commands/schema.rs`:
   ```
   vac schema dump --out <dir>
   ```
3. Emit schemas for types listed in [`upstream-vac-prs.md §4`](../../upstream-vac-prs.md#4-pr-3--vac-schema-dump).
4. Exclude TUI-internal types — add `#[serde(skip)]` or avoid `schemars` derive on them.
5. Integration test: dump → compare fragments against committed expectations.

**Exit**: `vac schema dump --out /tmp/x` produces files that `ajv` validates; parity with our `packages/protocol/v1/` (key fields match).

### S4 — PR #4: Profile loader + policy layer (1 day)

Most substantial PR. Per `upstream-vac-prs.md §5`:

1. Add `CapabilityProfile` struct in `vac_core::policy` matching `capability_profile.schema.json`.
2. YAML loader with `serde_yaml`; validate against committed schema.
3. Profile assets: copy `vac-web/packages/protocol/v1/profiles/` into `crates/vac_core/assets/profiles/` (or symlink + build step). Discuss with VAC maintainers whether to duplicate or reference.
4. Engine startup: accept `--profile <id@version>` flag; load; compute sha256; store.
5. Tool registry filter: at registration, unregister tools outside `tool_allow` / matching `tool_deny`.
6. Invocation guard: before exec, re-check tool + args; deny with structured error.
7. Handshake hook (new method) to receive bridge-advertised hash; abort if mismatch.
8. Tests: profile load, filter effect, invocation denial, hash mismatch abort.

**Exit**: unit + integration tests pass; hand-run `vac interactive --profile assessor.rtd@1.0.0` shows reduced tool surface.

### S5 — PR #5: `shell.exec_allowlisted` (0.3 day)

1. New tool in `vac_core::tools::shell_allowlisted`.
2. Signature per `upstream-vac-prs.md §6`.
3. Validator: parse `bin`, lookup in active profile's `shell_allowlist`, validate `args` array joined with `\x1F` against `args_pattern`, check `cwd` against `cwd_scope`, filter env by `env_allowlist`, enforce `timeout_ms`.
4. `side_effect: SideEffect::Shell`.
5. Tests: valid ls/cat/rg/git-read, rejected bash -c, rejected args injection.

**Exit**: tests green; used by red-team harness indirectly.

### S6 — PR #1: `vac serve --stdio` (0.7 day)

1. New binary target or subcommand.
2. Line-delimited JSON-RPC over stdin/stdout.
3. Maps command names to engine actions (reuse existing handlers, not `runner.rs`).
4. Emit events as JSON-RPC notifications.
5. stderr for logs (JSON structured).
6. Clean exit on EOF.
7. Integration test: spawn binary, send `message.submit`, read events.

**Exit**: bridge smoke test (Plan 07) can drive this.

### S7 — Draft of later PRs (0.3 day)

For PR #6, #7, #8, #9, #10: create draft issues/PRs with description + proposed shape, no implementation. Reviewers can comment early.

**Exit**: draft PRs visible upstream; discussion initiated.

## Testing

Each PR carries its own tests. At plan level:
- Integration: bridge can spawn `vac serve`, send commands, profile denial works end-to-end.
- Schema parity: `vac schema dump` output matches `vac-web/packages/protocol/v1/`.

## Exit criteria

- [ ] PRs #2, #3, #4, #5, #1 drafted (can be in flight / in review).
- [ ] PRs #2, #3 merged upstream (minimum unblock for Phase 1 work).
- [ ] PR #4 merged or close to it by end of Phase 0.5.
- [ ] Draft discussions open for #6, #7, #8, #9, #10.

## Risks

| Risk | Mitigation |
|---|---|
| Upstream reviewer slow | Start drafts immediately; pair-review with maintainer; small surface |
| Schema types diverge between VAC + vac-web | Plan 02 drift check compares `vac schema dump` output with our `protocol/v1/`; CI fails on mismatch |
| PR #4 too large | Split into: loader (no enforcement), then enforcement filter, then handshake |
| PR #1 tempted to wrap `runner.rs` | Explicit PR description: "new driver; do not use legacy runner" |

## Related

- [`upstream-vac-prs.md`](../../upstream-vac-prs.md) — authoritative PR descriptions
- [`capability-profiles.md`](../../capability-profiles.md) §6 — two-layer enforcement
- Plan 01 — schemas
- Plan 03 — profile YAMLs
- Plan 04 — red-team harness (uses these)
