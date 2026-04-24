# Plan 02 — Codegen pipeline (TS + Rust)

**Phase**: 0.5 · **Depends on**: Plan 01 · **Blocks**: all implementation · **Est**: 1–2 days

## Goal

Generate TypeScript + Rust types from the canonical JSON Schemas automatically. Both the web app and the bridge consume identical shapes; drift is impossible because generation is mechanical and CI-verified.

## Why this is hard

Off-the-shelf generators each have warts:
- `quicktype` sometimes loses enum names.
- `json-schema-to-typescript` doesn't handle discriminated unions idiomatically.
- `typify` (for Rust) needs draft-2020-12 support + careful enum handling.
Plus: discriminated unions (commands/events) must produce ergonomic types in both languages — tagged unions in Rust, type narrowing in TS.

## Scope

### In
- TS output at `packages/protocol-ts/src/v1/` — one file per schema + barrel.
- Rust output at `packages/protocol-rs/src/v1/` — serde-friendly structs + tagged enums.
- CI drift check: generated ≠ committed → fail.

### Out
- Runtime validators (separate plan, part of bridge).
- Documentation generation (v1 ships without HTML docs).

## Deliverables

```
packages/
├── protocol-ts/
│   ├── package.json
│   ├── src/v1/
│   │   ├── index.ts
│   │   ├── capability_profile.ts
│   │   ├── assessment_run.ts
│   │   ├── ...
│   │   └── _defs.ts
│   └── tests/roundtrip.test.ts
└── protocol-rs/
    ├── Cargo.toml
    ├── src/
    │   └── v1/
    │       ├── mod.rs
    │       ├── capability_profile.rs
    │       └── ...
    └── tests/roundtrip.rs
scripts/codegen.sh
scripts/verify-codegen.sh
```

## Stages

### S1 — Tooling decision (0.5 day)
Evaluate three candidates end-to-end on one complex schema (`assessment_run.schema.json`):
- TS: `json-schema-to-typescript` vs `quicktype`.
- Rust: `typify` vs `schemafy` vs hand-rolled `schemars`.

Scoring:
- Enum fidelity (names preserved, no `Enum_A` mangling).
- Discriminated union quality (TS: `type Cmd = ... | ...` narrow; Rust: `#[serde(tag = "type", content = "payload")]`).
- Nested `$defs` handling.
- Optional field mapping (`?` in TS, `Option<T>` in Rust).

**Exit**: decision recorded in `packages/protocol-ts/README.md` + `packages/protocol-rs/README.md` with rationale.

### S2 — TS generator (0.5 day)
Write `scripts/codegen.ts`:
```ts
for each schema in packages/protocol/v1/*.schema.json:
  emit TS file at packages/protocol-ts/src/v1/<name>.ts
emit barrel index.ts re-exporting all
emit command.ts + event.ts as discriminated unions
```

Post-processing:
- Replace generator's generic names with doc-friendly ones (regex).
- Prepend auto-generated warning banner.
- Run `prettier` to normalize output.

**Exit**: `pnpm --filter protocol-ts build` succeeds; sample consumer in a fixture compiles.

### S3 — Rust generator (0.5 day)
`scripts/codegen.rs` (or bash invoking `typify`):
- Emit one Rust module per schema.
- Attach `#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]`.
- Discriminated unions: `#[serde(tag = "type", content = "payload")]`.
- Preserve doc comments (schema `description` → Rust doc).

**Exit**: `cargo build -p protocol-rs` green.

### S4 — Round-trip tests (0.5 day)
For each `_samples/<schema>/valid-*.json`:
- TS: `JSON.parse` → cast to type → `JSON.stringify` → byte-identical (after canonicalization).
- Rust: `serde_json::from_str::<T>` → `serde_json::to_string` → byte-identical.

Any drift = test fails. Discovers encoder/decoder discrepancies.

**Exit**: all samples round-trip in both languages.

### S5 — CI drift check (0.5 day)
`scripts/verify-codegen.sh`:
```bash
scripts/codegen.sh
git diff --exit-code packages/protocol-ts packages/protocol-rs || \
  (echo "Generated code drifted — run scripts/codegen.sh and commit" && exit 1)
```
Run in CI on every PR.

**Exit**: PR that modifies schema without regenerating fails CI with clear message.

### S6 — Consumer ergonomics (0.5 day)
Add convenience helpers that aren't generated:
- TS: type guards `isEvent<T>(e, type)`, discriminated narrowers.
- Rust: `impl` blocks for common constructions (e.g., `Finding::new()` builder).

Keep these in separate files (`helpers.ts`, `helpers.rs`) so regeneration doesn't clobber them.

**Exit**: bridge + web can import narrowed types without manual casts.

## Testing

- Round-trip tests (S4).
- Build both packages in CI.
- Consumer smoke test: a fixture consumer app that imports from both packages.

## Exit criteria

- [ ] `scripts/codegen.sh` produces deterministic output (byte-identical across runs).
- [ ] `pnpm --filter protocol-ts build` green.
- [ ] `cargo build -p protocol-rs` green.
- [ ] All `_samples/*/valid-*` round-trip.
- [ ] CI drift check active and tested (deliberate drift commit rejected).

## Risks

| Risk | Mitigation |
|---|---|
| Generator output non-deterministic (ordering) | Post-sort JSON keys + prettier |
| Post-processed helper files accidentally regenerated | Separate dirs: `generated/` vs `helpers/`; codegen writes only to `generated/` |
| Drift check noisy on unrelated whitespace | Normalize via prettier + rustfmt before commit |
| Rust `typify` behind draft spec | Pin version; upstream patches if needed |

## Related

- Plan 01 — schemas (input)
- Plan 06 — upstream VAC schema dump (parallel producer of same types)
- [`architecture.md`](../../architecture.md) §12 versioning
