# Plan 03 — Profile YAML catalog

**Phase**: 0.5 · **Depends on**: Plan 01, 02 · **Blocks**: Plans 10, 26, 32, upstream PR #4 · **Est**: 1 day

## Goal

Author every `CapabilityProfile` YAML for v1, validate against schema, lock with hash manifest. These are the security boundary in executable form.

## Why this is hard

Each profile encodes a real threat model. A too-loose `tool_allow` list enables prompt-injection to mutate. A too-tight list breaks legitimate agent work. Getting the cut lines right requires cross-referencing every tool VAC exposes + every connector method + every shell binary we allow.

## Scope

### In
- All v1 profiles enumerated in `capability-profiles.md §4`.
- YAML format with `$schema` pointer to `capability_profile.schema.json`.
- Manifest with hash per profile.

### Out
- `executor.migration@1.0.0` (deferred to Phase 8).
- Per-project profile overrides (user feature, post-v1).

## Deliverables

```
packages/protocol/v1/profiles/
├── assessor.base@1.0.0.yaml
├── assessor.rtd@1.0.0.yaml
├── assessor.pm@1.0.0.yaml
├── assessor.ux@1.0.0.yaml
├── assessor.frontend@1.0.0.yaml
├── assessor.security@1.0.0.yaml
├── assessor.reliability@1.0.0.yaml
├── assessor.perf@1.0.0.yaml
├── assessor.release@1.0.0.yaml
├── assessor.launch@1.0.0.yaml
├── assessor.qa@1.0.0.yaml
├── assessor.docs@1.0.0.yaml
├── assessor.growth@1.0.0.yaml
├── executor.code@1.0.0.yaml
├── executor.release@1.0.0.yaml
└── PROFILES_MANIFEST.json
```

## Stages

### S1 — Author `assessor.base@1.0.0` (0.3 day)
Transcribe from `capability-profiles.md §4.1`. Pay attention to:
- `tool_deny` list is exhaustive; any write-class tool names VAC uses MUST be listed explicitly (not just wildcards).
- `shell_allowlist` regex patterns: verify each accepts expected cases, rejects injection attempts. Test locally.
- `fs.deny_globs` covers secret patterns.
- `network_egress` starts with empty host list; families extend.

**Exit**: YAML validates against `capability_profile.schema.json`. Unit test: load + serialize produces semantically equal.

### S2 — Family extensions (0.4 day)
For each `assessor.<family>`: inherit base via YAML anchors or bridge-side merge (decide — see Risk). Populate:
- `connectors.read`: just the connector ids the family needs.
- `network_egress.host_allowlist`: connector API hosts (from `connectors.md §6`).

Never override `tool_deny`, `fs`, `shell_allowlist` — these are safety floor.

**Exit**: all 12 family profiles validated. Diff check: each family differs from base only in connectors + hosts.

### S3 — Executor profiles (0.2 day)
Author `executor.code@1.0.0` and `executor.release@1.0.0` per `capability-profiles.md §4.2`.
Key invariants:
- `executor.code.tool_deny` includes `git_push`, `deploy.*`, `publish.*`.
- `executor.release.fs.write = scoped_paths` with `scoped_paths` enumerated.
- `executor.release.approval_required_for` covers `git.push`, `git.tag`, `deploy.*`, `publish.*`.
- `protected_refs` covers common branch names.

**Exit**: executor profiles validated. Red-team case #11 (executor.release writes src/main.rs) rejected at profile-load simulation.

### S4 — Hash manifest (0.1 day)
`PROFILES_MANIFEST.json`:
```json
{
  "version": "1.0.0",
  "profiles": {
    "assessor.base@1.0.0": "sha256:...",
    ...
  }
}
```
Computed over canonical YAML bytes (normalize line endings, key order via jq).

**Exit**: manifest committed; CI check detects YAML edit without manifest bump.

### S5 — Shell allowlist integration test (0.1 day)
Standalone Rust test that loads each profile, walks `shell_allowlist`, generates representative arg strings per pattern:
- Positive cases: `git status`, `git diff HEAD`, `rg --json pattern`, `ls -la`.
- Negative cases: `git push`, `bash -c 'rm -rf /'`, `rg --pre /evil`.
Every positive accepted, every negative rejected.

**Exit**: test passes.

### S6 — Documentation cross-check (0.1 day)
Read `capability-profiles.md §4` side-by-side with YAML. Fix any drift. Add inline comments in YAML pointing to the doc section.

**Exit**: every profile file's first line references doc anchor; doc matches YAML field-for-field.

## Testing

- Schema validation (S1–S3).
- Shell allowlist behavioural test (S5).
- Manifest drift check in CI (S4).
- Integration test in bridge (Plan 10): profile loads → bridge enforcement honors.

## Exit criteria

- [ ] 15 profile YAMLs committed.
- [ ] All validate against `capability_profile.schema.json`.
- [ ] `PROFILES_MANIFEST.json` hashes match.
- [ ] Shell allowlist positive/negative test passes.
- [ ] CI check: YAML edit without manifest bump rejected.

## Risks

| Risk | Mitigation |
|---|---|
| YAML anchor inheritance brittle | Bridge-side merge preferred: `assessor.*` files list only diffs; loader merges with base |
| Missed write-class tool in `tool_deny` | Cross-reference list of all VAC tools in `upstream-vac-prs.md §3`; unit test asserts every non-read tool is in deny for assessor |
| Shell pattern regex false negatives | Seed with 20+ known payloads from red-team matrix |
| Profile drifts from doc silently | Doc-anchor-in-comment convention; reviewer checks both |

## Related

- [`capability-profiles.md`](../../capability-profiles.md)
- [`connectors.md`](../../connectors.md) §6 hosts
- Plan 01 — schema
- Plan 04 — red-team harness uses these
- Upstream VAC PR #4 — loader
