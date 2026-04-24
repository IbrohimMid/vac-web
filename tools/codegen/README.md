# `vac-codegen`

Self-contained JSON Schema → TypeScript + Rust generator. Lives in `tools/codegen/` because it's build tooling, not shipped in the bridge.

## Why custom (vs `typify` / `json-schema-to-typescript`)?

- **No external tool install** — works with only `cargo`. Keeps CI simple; no `pnpm install` dependency for codegen.
- **Deterministic output** — sorted fields + normalized names; byte-identical across runs.
- **Matches our schema shapes** — handles `_defs/primitives.schema.json#/$defs/*` refs, discriminated unions on envelope schemas, optional field markers from `required[]`.
- **Inspectable** — ~400 LOC Rust, easy to audit + extend.

Swap to external tools later is a drop-in: same input (schemas), same output paths.

## Usage

```bash
# regenerate all types
bash scripts/codegen.sh

# or directly
cargo run -p codegen -- \
  --schemas packages/protocol/v1 \
  --ts-out packages/protocol-ts/src/v1/generated \
  --rs-out packages/protocol-rs/src/v1/generated
```

## Output

Per schema `X.schema.json`:
- TS: `packages/protocol-ts/src/v1/generated/X.ts` with `export interface X` (or `export type X = ...` for enums/discriminated unions).
- Rust: `packages/protocol-rs/src/v1/generated/x.rs` with `#[derive(Serialize, Deserialize, …)] pub struct X` or `pub enum X`.
- Barrel: `index.ts` re-exports all; `mod.rs` declares + flat-re-exports all.

## Discriminated unions

Envelope schemas (those with a `type` property whose value is an enum + a `payload` property) emit a TS tagged union:

```ts
export type Command =
  | { id: string; session_id: string; v: number; type: 'message.submit'; payload: unknown; }
  | { id: string; session_id: string; v: number; type: 'approval.approve'; payload: unknown; }
  | ...
```

Narrow with `if (cmd.type === 'message.submit') { … }`.

Rust side currently emits a flat struct (`type: String`, `payload: serde_json::Value`); consumers dispatch manually. Phase 1 will add per-type payload structs + enum wrapper.

## Limits (intentional, for v1)

- No recursive schema support beyond what our own schemas use.
- No `oneOf` / `anyOf` in property types (only root-level via `type` enum).
- No per-property enums → Rust; enums become `String` with serde accepting any value. Load-time validation via `profile-core` or ajv covers.
- No JSDoc / rustdoc synthesis from `description`. Add when needed.

## Testing

```bash
cargo test -p codegen
```

Unit tests cover case conversion, ref resolution, and type mapping. Round-trip coverage of actual generated types lives in `packages/protocol-rs/tests/roundtrip.rs` (every `valid-*.json` sample must parse + re-serialize to identical canonical form).

## Determinism guarantee

`scripts/verify-codegen.sh` runs codegen + `git diff --exit-code` on output dirs. CI fails if generated code drifted from commit. To regenerate intentionally, run `scripts/codegen.sh` and commit.
