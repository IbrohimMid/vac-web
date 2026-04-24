# `profile-core`

Capability profile loader + enforcement primitives. **The security boundary for vac-web.**

Consumed by:
- `local-bridge` (Layer 1 enforcement — planned Phase 1 Plan 10).
- `tests/red-team` (adversarial test suite).
- Future: upstream `vac_core` engine (Layer 2, via PR #4).

## Responsibilities

1. **Load** `CapabilityProfile` YAMLs from `packages/protocol/v1/profiles/`.
2. **Merge** `inherits_from` chains (child adds connectors + hosts only; cannot weaken parent).
3. **Validate** class-specific invariants (assessor: no writes, no connector.write; executor: scoped_paths consistency).
4. **Enforce** at tool-call time via pure functions:
   - `enforce_tool(profile, tool)`
   - `enforce_shell(profile, bin, args)`
   - `enforce_fs_read(profile, path, project_root)`
   - `enforce_fs_write(profile, path, project_root)`
   - `enforce_network(profile, host, method)`
5. **Hash** profile YAMLs for bridge/engine handshake pinning.

## Design constraints

- **No I/O in enforcement path** — decisions are pure functions over structs. Callers pre-read paths.
- **No async** — enforcement is hot; must be sub-µs in most cases.
- **Deny wins** — explicit deny > allow > default deny.
- **No heap allocation in happy path** where avoidable (future optimization).
- **Regex ReDoS capped** — patterns from YAML are trusted, but `size_limit`/`dfa_size_limit` applied as defense-in-depth.
- **DNS case-insensitive** host matching.

## Invariants enforced at load time

Assessor (`class: assessor`):
- `fs.write == "none"`
- No git write flags (`branch`, `commit`, `tag`, `push`)
- `connectors.write` empty
- No forbidden tools in `tool_allow` (edit_file, write_file, bash, git_commit, git_push, git_tag, etc.)

Executor (`class: executor`):
- `fs.write == "scoped_paths"` implies non-empty `scoped_paths`
- `git.push == true` implies non-empty `push_remotes_allow`
- Every `connectors.write` entry has matching `connector.write.<id>` in `tool_allow` (or wildcard)

Violations → `CapabilityProfile::load` returns `Err`.

## Testing

```bash
cargo test -p profile-core
```

Four test files:
- `enforce_basics.rs` — tool allow/deny, fs scope, network egress.
- `shell_allowlist.rs` — positive + negative shell cases.
- `inheritance.rs` — base → family merge, per-family invariants.
- `canonical_hash.rs` — verifies Rust hash matches Python `manifest-verify.sh` output for every schema.

## Related

- [`docs/capability-profiles.md`](../../docs/capability-profiles.md) — SSOT specification.
- [`docs/plans/phase-0.3/README.md`](../../docs/plans/phase-0.3/README.md) — Phase 0.3 plan.
- [`docs/red-team-test-plan.md`](../../docs/red-team-test-plan.md) — adversarial cases this crate enforces against.
