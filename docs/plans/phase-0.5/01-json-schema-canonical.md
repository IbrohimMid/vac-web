# Plan 01 — JSON Schema canonical authoring

**Phase**: 0.5 · **Depends on**: Phase 0 docs · **Blocks**: plans 02, 06, all subsequent · **Est**: 2–3 days

## Goal

Produce the canonical machine-readable JSON Schema for every protocol v1 semantic type so that codegen, validation, and upstream VAC `vac schema dump` all agree. This is the SSOT for shape; docs are SSOT for semantics.

## Why this is hard

The docs describe shapes in pseudo-JSON. Turning that into strict schema surfaces hidden ambiguity: polymorphic types (discriminated unions), optional vs required, pattern constraints, cross-field invariants. We must resolve every ambiguity now — a schema edit after Phase 1 is a breaking change.

## Scope

### In
- All shapes referenced by `protocol.md`, `assessment-contract.md`, `handoff-contract.md`, `gates.md`, `evidence-freshness.md`, `capability-profiles.md`.
- Root schemas for `command` and `event` as **discriminated unions** over `type`.
- Reusable type fragments via `$defs`.

### Out
- Frontend-internal types (store shapes, component props).
- VAC engine-internal types.
- TUI enums (deliberately excluded per upstream-vac-prs.md).

## Deliverables

`packages/protocol/v1/`:
```
action_spec.schema.json
capability_profile.schema.json
evidence_ref.schema.json
assessment_run.schema.json
assessment_finding.schema.json
assessment_verdict.schema.json
assessment_diff.schema.json
remediation_plan.schema.json
handoff_packet.schema.json
gate_status.schema.json
gate_policy.schema.json
session_snapshot.schema.json
connector_snapshot.schema.json
notify_event.schema.json
system_pulse.schema.json
overlay.schema.json
transcript_message.schema.json
tool_call.schema.json
command.schema.json       # discriminated union root
event.schema.json         # discriminated union root
_defs/
  severity.schema.json
  ulid.schema.json
  iso8601.schema.json
  sha256.schema.json
  ...
```

## Stages

### S1 — Primitive defs (0.5 day)
Authoritative reusable fragments under `_defs/`:
- `ulid`: string pattern `^[0-9A-HJKMNP-TV-Z]{26}$`.
- `iso8601`: string with RFC 3339 format.
- `sha256`: string pattern `^sha256:[0-9a-f]{64}$`.
- `severity`: enum `["ok","info","warn","error","critical","high","medium","low"]`.
- `lane`: enum `["transient","persistent","sticky"]`.
- `subsystem`: string pattern matching `ux-grammar.md §3`.
- `profile_id_versioned`: string pattern `^(assessor|executor)\.[a-z0-9_]+(\.[a-z0-9_]+)*@\d+\.\d+\.\d+$`.

**Exit**: every other schema references these; no inline pattern duplication.

### S2 — Entity schemas (1 day)
Transcribe each entity doc section → `.schema.json` with:
- `$schema`: `https://json-schema.org/draft/2020-12/schema`.
- `$id`: `https://vac-web/schema/v1/<name>.json`.
- `title`, `description` (one-liner from its doc).
- `type: object`, `required`, `properties`, `additionalProperties: false` everywhere unless explicitly extensible.
- `$defs` for nested objects unique to this schema.
- Cross-file references via relative `$ref`.

Order of authoring (least → most dependent): `evidence_ref` → `connector_snapshot` → `assessment_finding` → `assessment_verdict` → `remediation_plan` → `assessment_run` → `assessment_diff` → `handoff_packet` → `gate_policy` → `gate_status` → `capability_profile` → `notify_event` → `system_pulse` → `overlay` → `action_spec` → `transcript_message` → `tool_call` → `session_snapshot`.

**Exit**: each schema validates a hand-authored sample under `_samples/` with `ajv --strict`.

### S3 — Discriminated union roots (0.5 day)
`command.schema.json`:
```jsonc
{
  "oneOf": [
    { "$ref": "#/$defs/cmd_message_submit" },
    { "$ref": "#/$defs/cmd_approval_approve" },
    ...
  ],
  "$defs": { ... }      // per-type envelope with { type, payload }
}
```
Same for `event.schema.json`. Every command/event type from `protocol.md` §3–§4 represented.

**Exit**: unknown `type` fails validation; known types validate payload against typed schema.

### S4 — Cross-field invariants (0.5 day)
JSON Schema can't express all constraints (e.g., "`critical` severity → `confidence ≥ 0.7`"). Use `allOf` + `if/then` where possible; otherwise document as **"assertion"** block at bottom of each schema:
```jsonc
"x-assertions": [
  "severity=critical implies confidence >= 0.7",
  "evidence.length >= 1"
]
```
These drive validator codegen in Plan 02.

**Exit**: assertion list authored per schema; validator generator stub accepts them.

### S5 — Samples + fixtures (0.5 day)
Every schema has ≥ 3 samples under `_samples/<schema>/<case>.json`:
- Minimal valid instance.
- Maximal valid instance (all optional fields populated).
- Representative failing instance (documents expected error).

Used as codegen regression fixtures.

**Exit**: `pnpm validate` runs `ajv` over all samples; passing = expected, failing = expected-to-fail.

### S6 — Hash snapshot (0.5 day)
Compute `sha256` over canonicalized (RFC 8785 JCS) schema bytes; write to `packages/protocol/v1/MANIFEST.json`:
```json
{
  "version": "1.0.0",
  "schemas": { "capability_profile.schema.json": "sha256:...", ... }
}
```
Bridge + engine both compute and compare at handshake. Manifest is checked into git; CI fails if schema edited without manifest bump.

**Exit**: `pnpm manifest:verify` green.

## Testing

- `ajv-cli` validates every sample against its schema.
- `pnpm schema:lint` runs `json-schema-lint` against draft-2020-12 rules.
- CI job fails on any schema diff without manifest update.

## Exit criteria (plan level)

- [ ] All entities from blueprint docs have a corresponding `.schema.json`.
- [ ] All `_samples/*/valid-*.json` validate; `invalid-*.json` fail.
- [ ] Discriminated unions (`command`, `event`) accept all types from `protocol.md`.
- [ ] MANIFEST.json hashes committed.
- [ ] `ajv --strict` clean (no unknown keywords, no missing $refs).

## Risks

| Risk | Mitigation |
|---|---|
| Ambiguity in docs surfaces contradictions | Keep edits to doc in same PR as schema; never drift |
| Schema changes after Phase 1 = breaking | v1 frozen via MANIFEST; any change = v2 branch |
| `additionalProperties: false` breaks future extension | Add explicit `extensions: object` field where extensibility is wanted |
| Draft version drift between tools | Pin to draft 2020-12 everywhere |

## Related

- [`protocol.md`](../../protocol.md)
- [`assessment-contract.md`](../../assessment-contract.md)
- [`handoff-contract.md`](../../handoff-contract.md)
- Plan 02 — codegen pipeline
- Plan 06 — upstream VAC PRs (schema dump)
