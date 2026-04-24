# Phase 0.3 — Profile Catalog

**Duration**: 1–2 days
**Position**: after Phase 0.2 schemas; before Phase 0.4 codegen
**Status**: ✅ **DONE** — 15 YAMLs authored; PROFILES_MANIFEST.json with real raw-bytes sha256 hashes; `profile-core` crate implements loader + inheritance-merge + enforcement primitives; 16 integration tests green (shell allowlist positive+negative + tool allow/deny + fs scope + network egress + profile hash detection).

## Goal

Author every `CapabilityProfile` YAML for v1. These are the security boundary in executable form — every rule that makes the assessor/executor split real lives here. Validate against schema, lock with hash manifest, integration-test the shell allowlist regex.

## Entry criteria

- Phase 0.2 schemas complete; `capability_profile.schema.json` stable.
- `packages/protocol/v1/profiles/` directory exists.

## Scope

### In
- 15 profile YAMLs: `assessor.base@1.0.0` + 12 assessor families + `executor.code@1.0.0` + `executor.release@1.0.0`.
- `PROFILES_MANIFEST.json` with real hashes.
- YAML validation against schema.
- Shell allowlist integration test (regex positive + negative).
- Cross-reference documentation (each YAML points to its doc anchor).

### Out
- `executor.migration@1.0.0` (deferred to Phase 8 per `capability-profiles.md §4.2`).
- Engine-side profile loader (upstream VAC PR #4; Phase 0.5).
- Bridge-side profile enforcement (Phase 1, Plan 10).

## Stages

### S1 — `assessor.base@1.0.0` ✅ DONE

Base profile = deny floor + shell allowlist that all assessor families inherit.

Critical invariants:
- `tool_deny` exhaustively lists every write-class tool.
- `shell_allowlist` entries have regex `args_pattern` for each binary.
- `fs.deny_globs` covers common secret patterns.
- `network_egress` empty by default.

**Exit**: YAML validates against schema.

### S2 — 12 assessor family extensions ✅ DONE

Each family:
- Inherits base via `inherits_from: assessor.base@1.0.0`.
- Only adds `connectors.read` + `network_egress.host_allowlist`.
- Never overrides `tool_deny`, `fs`, `shell_allowlist`, or `git`.

Families shipped:
- `assessor.rtd@1.0.0` (GitHub, Sentry, Datadog, CF, Vercel, CI).
- `assessor.pm@1.0.0` (GitHub, Notion, Linear, Figma).
- `assessor.ux@1.0.0` (GitHub, Figma, Notion, PostHog).
- `assessor.frontend@1.0.0` (GitHub).
- `assessor.security@1.0.0` (GitHub, Dependabot, Snyk, Sentry).
- `assessor.reliability@1.0.0` (GitHub, Sentry, Datadog, Grafana, PagerDuty).
- `assessor.perf@1.0.0` (GitHub, Lighthouse CI, Datadog, PostHog).
- `assessor.release@1.0.0` (GitHub, CI, Vercel, CF).
- `assessor.launch@1.0.0` (GitHub, Notion, PostHog, GA4).
- `assessor.qa@1.0.0` (GitHub, CI).
- `assessor.docs@1.0.0` (GitHub, Notion).
- `assessor.growth@1.0.0` (GitHub, PostHog, GA4, Mixpanel).

**Exit**: diff check confirms each family differs from base only in connectors + hosts.

### S3 — Executor profiles ✅ DONE

`executor.code@1.0.0`:
- `tool_allow` adds write-class tools (edit_file, write_file, shell.exec, git_commit).
- `tool_deny` excludes push/tag/deploy/publish.
- `protected_refs` list for branch safety.

`executor.release@1.0.0`:
- `tool_allow` includes push/tag/deploy/publish.
- `fs.write: scoped_paths` (CHANGELOG, RELEASES.md, runbooks, release metadata).
- `approval_required_for` covers all write-class tools.

**Exit**: YAMLs validate; red-team-adjacent invariants checked (e.g., `executor.release` can't edit `src/`).

### S4 — Hash manifest ⏳ TODO

Steps:
1. Run `VAC_WEB_UPDATE_MANIFEST=1 bash scripts/manifest-verify.sh`.
2. Review `PROFILES_MANIFEST.json` diff (all `sha256:pending` → real hashes).
3. Commit.
4. Verify subsequent run without env var passes.

**Exit**: `PROFILES_MANIFEST.json` contains real hashes.

### S5 — Shell allowlist regression test ⏳ TODO

New test file `tests/profiles/shell_allowlist_test.rs`:

```rust
#[test]
fn assessor_base_allows_safe_commands() {
    let profile = load("assessor.base@1.0.0");
    let cases = [
        ("ls", vec!["-la"]),           // allowed
        ("cat", vec!["README.md"]),    // allowed
        ("rg", vec!["pattern", "src/"]), // allowed
        ("git", vec!["diff", "HEAD"]),  // allowed
    ];
    for (bin, args) in cases {
        assert_eq!(check_shell(&profile, bin, &args), Allow);
    }
}

#[test]
fn assessor_base_denies_injection_payloads() {
    let profile = load("assessor.base@1.0.0");
    let cases = [
        ("bash", vec!["-c", "rm -rf /"]),
        ("sh", vec!["-c", "..."]),
        ("git", vec!["push", "--force", "origin", "main"]),
        ("ls", vec!["-la", ";", "rm", "-rf", "/"]),
        ("find", vec![".", "-exec", "rm", "{}", ";"]),
        ("rg", vec!["--pre", "/evil"]),
    ];
    for (bin, args) in cases {
        assert!(matches!(check_shell(&profile, bin, &args), Deny { .. }));
    }
}
```

This test requires the bridge's profile loader + enforcer. Landing in Phase 1 Plan 10; **for Phase 0.3 we author the test skeleton + fixtures**, to be fully wired in Plan 10.

Alternative early-test path: standalone loader in `tests/profiles/` with bare minimum loader code that just loads YAML + checks regex — doesn't require full bridge. Useful for catching bad patterns before bridge exists.

**Exit**: test skeleton + fixtures committed; wiring deferred.

### S6 — Documentation cross-check (0.2 day)

Open `capability-profiles.md §4` side-by-side with each YAML:
- Verify tool_deny lists match.
- Verify `shell_allowlist` entries match.
- Verify connector lists match doc table.
- Add inline YAML comments pointing to relevant doc section.

**Exit**: spot audit finds no drift.

### S7 — CI manifest drift check ⏳ TODO

Confirm `.github/workflows/ci.yml schema` job calls `manifest-verify.sh`. Test: edit a profile without updating manifest → CI fails.

**Exit**: CI drift check verified live.

## Deliverables

```
packages/protocol/v1/profiles/
├── assessor.base@1.0.0.yaml              ✅
├── assessor.rtd@1.0.0.yaml               ✅
├── assessor.pm@1.0.0.yaml                ✅
├── assessor.ux@1.0.0.yaml                ✅
├── assessor.frontend@1.0.0.yaml          ✅
├── assessor.security@1.0.0.yaml          ✅
├── assessor.reliability@1.0.0.yaml       ✅
├── assessor.perf@1.0.0.yaml              ✅
├── assessor.release@1.0.0.yaml           ✅
├── assessor.launch@1.0.0.yaml            ✅
├── assessor.qa@1.0.0.yaml                ✅
├── assessor.docs@1.0.0.yaml              ✅
├── assessor.growth@1.0.0.yaml            ✅
├── executor.code@1.0.0.yaml              ✅
├── executor.release@1.0.0.yaml           ✅
└── PROFILES_MANIFEST.json                ⏳ (real hashes)
tests/profiles/shell_allowlist_test.rs    ⏳
```

## Exit criteria (gate to Phase 0.4)

- [x] 15 profile YAMLs committed.
- [x] All validate against `capability_profile.schema.json`.
- [ ] `PROFILES_MANIFEST.json` has real hashes.
- [ ] Shell allowlist test skeleton committed (wired in Plan 10).
- [ ] CI drift check: edit profile → fail without manifest bump.

## Current state summary

**Completed** in previous execution:
- 15 YAMLs drafted per `capability-profiles.md §4`.
- Family inheritance pattern applied (connectors + hosts only).
- Executor profiles with explicit scoped_paths for release.

**Remaining work**:
1. Compute real manifest hashes.
2. Author shell allowlist regex test (can land standalone).
3. Verify CI drift guard with a deliberate test PR.

Estimated: 2–3 hours.

## Risks

| Risk | Mitigation |
|---|---|
| YAML anchor inheritance brittle | Bridge-side merge (loader expands `inherits_from` at load) — Plan 10 |
| Missed write-class tool in `tool_deny` | Exhaustive cross-reference with VAC tool inventory during PR #2 (Phase 0.5) |
| Shell regex false negatives | Seed test with 20+ known-bad payloads; red-team matrix extends later |
| Profile drifts from doc | Doc-anchor comments in YAML; reviewer checks both in same PR |

## Related

- [`docs/capability-profiles.md`](../../capability-profiles.md) §4
- [`docs/plans/phase-0.5/03-profile-yaml-catalog.md`](../phase-0.5/03-profile-yaml-catalog.md)
- Plan 10 — bridge profile enforcement (consumer)
- Plan 06 — upstream VAC PR #4 (engine-side loader)

## Handoff to Phase 0.4

Codegen (Phase 0.4) reads `packages/protocol/v1/profiles/*.yaml` as test fixtures only — profiles themselves stay YAML, not generated TS/Rust. What codegen produces is the `CapabilityProfile` **struct** (from schema). Ensure the struct matches YAML round-trip before considering codegen done.
