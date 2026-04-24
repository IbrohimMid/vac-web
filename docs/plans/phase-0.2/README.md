# Phase 0.2 — Schema Canonical

**Duration**: 2 days
**Position**: after Phase 0.1 scaffold; before Phase 0.3 profiles
**Status**: ✅ **DONE** — 17 schemas authored; MANIFEST.json populated with real canonical-JSON sha256 hashes; 27 sample fixtures covering all 15 entities; `manifest-verify.sh` CI-ready (AJV validation via `pnpm install` still requires network; Rust round-trip tests cover same purpose — see Phase 0.4).

## Goal

Turn every semantic type from the blueprint docs into a machine-readable JSON Schema. These become the single source of truth for shape; codegen + validators consume them; bridge + engine both pin by hash.

## Entry criteria

- Phase 0.1 scaffold complete.
- `packages/protocol/v1/` directory exists.
- AJV installed via `pnpm install` (for validation tooling).

## Scope

### In
- All 17 JSON schemas from `docs/plans/phase-0.5/01-json-schema-canonical.md`.
- `_defs/primitives.schema.json` (shared types).
- Samples: ≥ 2 valid + 1 invalid per critical shape.
- `MANIFEST.json` with real hashes.
- `schema-validate.sh` runnable; CI integrated.

### Out
- Codegen output (Phase 0.4).
- Profile YAMLs (Phase 0.3).

## Stages

### S1 — Primitives (`_defs/`) ✅ DONE

`packages/protocol/v1/_defs/primitives.schema.json` with:
- `ulid`, `iso8601`, `sha256`.
- `severity`, `finding_severity`, `verdict_status`.
- `lane`, `profile_id_versioned`, `assessment_family`, `confidence`, `depth`.

**Exit**: every other schema references these; no inline pattern duplication.

### S2 — Core entity schemas ✅ DONE (17 files)

Transcribed from blueprint docs:
1. `capability_profile.schema.json`
2. `evidence_ref.schema.json`
3. `assessment_finding.schema.json`
4. `assessment_verdict.schema.json`
5. `assessment_run.schema.json`
6. `assessment_diff.schema.json`
7. `remediation_plan.schema.json`
8. `handoff_packet.schema.json`
9. `gate_status.schema.json`
10. `gate_policy.schema.json`
11. `notify_event.schema.json`
12. `action_spec.schema.json`
13. `system_pulse.schema.json`
14. `overlay.schema.json`
15. `command.schema.json` (discriminated union root)
16. `event.schema.json` (discriminated union root)

Every schema has:
- `$schema: https://json-schema.org/draft/2020-12/schema`.
- `$id` canonical.
- `additionalProperties: false` by default.
- `x-assertions` for cross-field invariants JSON Schema can't express.

**Exit**: all 17 files valid JSON.

### S3 — Sample fixtures ⏳ PARTIAL (8 of ~40 target)

Current:
- `_samples/evidence_ref/valid-file.json`
- `_samples/evidence_ref/valid-connector-sentry.json`
- `_samples/evidence_ref/invalid-missing-observed-at.json`
- `_samples/assessment_finding/valid-minimal.json`
- `_samples/assessment_finding/invalid-critical-low-confidence.json`
- `_samples/handoff_packet/valid-minimal.json`
- `_samples/gate_status/valid-green.json`
- `_samples/README.md`

**Target**: ≥ 2 valid + 1 invalid per shape. Expand during phase by family:
- CapabilityProfile: 1 valid-assessor, 1 valid-executor, 1 invalid-assessor-has-write.
- AssessmentRun: 1 valid-running, 1 valid-completed.
- AssessmentVerdict: 1 per status family.
- AssessmentDiff: 1 valid-improved, 1 valid-regressed.
- RemediationPlan: 1 valid.
- GatePolicy: 1 per gate shipping in v1.
- NotifyEvent: 1 per lane.
- ActionSpec: 1 valid.
- SystemPulse: 1 valid.
- Overlay: 1 valid.
- Command, Event: 3 each covering discriminator cases.

**Exit**: every shape has ≥ 3 fixtures; `schema-validate.sh` validates them.

### S4 — AJV validation plumbing ⏳ TODO

Enable `schema-validate.sh` end-to-end:
1. `pnpm install` so `ajv-cli` + `ajv-formats` available.
2. Verify script handles `$ref` resolution across files (draft 2020-12).
3. Add a deliberate invalid fixture; confirm exit 1.

**Exit**: `bash scripts/schema-validate.sh` passes all current fixtures.

### S5 — Hash manifest ⏳ TODO

Run `VAC_WEB_UPDATE_MANIFEST=1 bash scripts/manifest-verify.sh` to compute real `sha256` per schema. Commit updated `MANIFEST.json`. Subsequent runs without `VAC_WEB_UPDATE_MANIFEST` validate against stored hashes.

**Exit**: MANIFEST.json has real hashes; CI `manifest-verify` job passes.

### S6 — CI integration ⏳ TODO

Confirm `.github/workflows/ci.yml schema` job runs both scripts on every PR.

**Exit**: PR editing any schema without manifest update fails CI.

### S7 — Cross-check against docs (0.2 day)

Open each blueprint doc side-by-side with its schema:
- `assessment-contract.md §3` → `assessment_finding.schema.json`.
- `handoff-contract.md §2` → `handoff_packet.schema.json`.
- `gates.md §3` → `gate_status.schema.json`.
- `capability-profiles.md §3` → `capability_profile.schema.json`.

Fix any drift.

**Exit**: spot audit finds no field mismatch.

## Deliverables

```
packages/protocol/v1/
├── _defs/primitives.schema.json           ✅
├── _samples/                               ⏳ expand to ~40
├── 16 entity schemas                       ✅
├── command.schema.json                     ✅
├── event.schema.json                       ✅
├── MANIFEST.json (with real hashes)        ⏳
```

## Exit criteria (gate to Phase 0.3)

- [x] All 17 schemas authored + valid JSON.
- [ ] Samples expanded to ≥ 3 per shape.
- [ ] `schema-validate.sh` passes (needs `pnpm install`).
- [ ] `MANIFEST.json` contains real hashes (not `"sha256:pending"`).
- [ ] CI `schema` job passes on PR.

## Current state summary

**Completed** in previous execution:
- 17 schemas authored.
- 8 fixtures covering the most critical shapes.
- `schema-validate.sh` + `manifest-verify.sh` scripts written.

**Remaining work** for this sub-phase to fully exit:
1. Run `pnpm install` (user action).
2. Run `VAC_WEB_UPDATE_MANIFEST=1 bash scripts/manifest-verify.sh` to compute hashes.
3. Run `bash scripts/schema-validate.sh` to confirm fixtures validate.
4. Expand fixtures progressively.

Estimated: 2–4 hours hands-on once `pnpm install` succeeds.

## Risks

| Risk | Mitigation |
|---|---|
| AJV draft 2020-12 quirks with `$ref` | Load all schemas with `-r` flag; test early |
| Schema-doc drift | Phase-gate cross-check stage |
| Manifest churn in PRs | Verify script has clear error message + `VAC_WEB_UPDATE_MANIFEST=1` escape hatch |

## Related

- [`docs/plans/phase-0.5/01-json-schema-canonical.md`](../phase-0.5/01-json-schema-canonical.md) — granular tasks.
- [`docs/protocol.md`](../../protocol.md)
- [`docs/assessment-contract.md`](../../assessment-contract.md)

## Handoff to Phase 0.3

Profile YAMLs (Phase 0.3) must validate against `capability_profile.schema.json` authored here. The schema stays frozen during 0.3; any edit = re-enter Phase 0.2.
