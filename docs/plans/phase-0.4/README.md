# Phase 0.4 — Codegen Pipeline

**Duration**: 1–2 days
**Position**: after Phase 0.3 profiles; before Phase 0.5 red-team + upstream
**Status**: ✅ **DONE** (custom-path). Instead of external generators (`json-schema-to-typescript` + `typify`, which require `pnpm install`/network), implemented a self-contained Rust binary `tools/codegen/` that reads schemas + emits idiomatic TS interfaces and serde Rust structs. 16 modules generated deterministically; 13 round-trip tests passing; `scripts/codegen.sh` wired. Swap to external tools later is a drop-in replacement (same output contract).

## Goal

Generate TypeScript + Rust types from JSON schemas automatically. Web + bridge consume identical shapes; drift is impossible because generation is mechanical and CI-verified. Turns the schemas from "documentation" into "enforceable types at build time."

## Entry criteria

- Phase 0.2 schemas stable (`MANIFEST.json` with real hashes).
- Phase 0.3 profiles round-trip through YAML ↔ struct.
- `pnpm install` succeeded locally (tools available).

## Scope

### In
- TS generator: JSON Schema → idiomatic TypeScript types (discriminated unions preserved).
- Rust generator: JSON Schema → serde-friendly structs (tagged enums for unions).
- Generated output under `packages/protocol-ts/src/v1/generated/` + `packages/protocol-rs/src/v1/generated/`.
- Hand-authored helpers in `packages/*/src/v1/helpers.*` (never clobbered by regen).
- CI drift check: generated ≠ committed → fail.
- Round-trip test: sample → parse → serialize → byte-equal.

### Out
- Runtime validators (separate, part of bridge Plan 10).
- HTML docs generation.

## Stages

### S1 — Tool selection (0.3 day)

Test three candidates end-to-end on a complex schema (`assessment_run.schema.json` recommended — it has enums, nested objects, arrays, `$ref`).

#### TypeScript

| Tool | Pros | Cons |
|---|---|---|
| `json-schema-to-typescript` | Stable; preserves comments as JSDoc | Discriminated unions verbose |
| `quicktype` | Good DU handling | Occasional mangled names |

**Recommended**: `json-schema-to-typescript` — more predictable.

#### Rust

| Tool | Pros | Cons |
|---|---|---|
| `typify` | Draft 2020-12 support; good enums | CLI still maturing |
| `schemafy` | Older, stable | Less draft 2020 support |
| Hand-rolled via `schemars` reverse | Max control | Lots of code to maintain |

**Recommended**: `typify` CLI.

Evaluation criteria:
- Enum fidelity (names preserved).
- Discriminated unions idiomatic.
- Nested `$defs` handling.
- Optional fields mapped correctly (`?` in TS, `Option<T>` in Rust).

**Exit**: decision recorded in `packages/protocol-ts/README.md` + `packages/protocol-rs/README.md` with rationale.

### S2 — TS generator script (0.3 day)

Update `scripts/codegen.sh`:

```bash
# Clean output dir
rm -rf packages/protocol-ts/src/v1/generated
mkdir -p packages/protocol-ts/src/v1/generated

# Generate per schema
for schema in packages/protocol/v1/*.schema.json; do
  name=$(basename "$schema" .schema.json)
  pnpm exec json-schema-to-typescript \
    "$schema" \
    -o "packages/protocol-ts/src/v1/generated/${name}.ts" \
    --strictIndexSignatures \
    --style.singleQuote \
    --style.trailingComma=all
done

# Barrel
ls packages/protocol-ts/src/v1/generated/*.ts | \
  xargs -n1 basename | sed 's/\.ts$//' | \
  awk '{print "export * from \"./" $1 "\";"}' \
  > packages/protocol-ts/src/v1/generated/index.ts

# Format
pnpm exec prettier --write packages/protocol-ts/src/v1/generated/
```

Handle command/event discriminated union specifically — raw output rarely gives nice DU; post-process if needed.

**Exit**: `pnpm --filter @vac-web/protocol build` succeeds; types importable.

### S3 — Rust generator script (0.3 day)

```bash
rm -rf packages/protocol-rs/src/v1/generated
mkdir -p packages/protocol-rs/src/v1/generated

# typify per schema, merged into single module
for schema in packages/protocol/v1/*.schema.json; do
  name=$(basename "$schema" .schema.json)
  typify "$schema" --output "packages/protocol-rs/src/v1/generated/${name}.rs"
done

# mod.rs barrel
ls packages/protocol-rs/src/v1/generated/*.rs | xargs -n1 basename | sed 's/\.rs$//' | \
  awk '{print "pub mod " $1 ";"}' \
  > packages/protocol-rs/src/v1/generated/mod.rs

# Format
cargo fmt -p protocol-rs
```

Rust-specific: ensure `#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]` present. `#[serde(tag = "type", content = "payload")]` for command/event.

**Exit**: `cargo build -p protocol-rs` green.

### S4 — Hand-authored helpers (0.2 day)

Generated code is never hand-edited. Helpers live in separate files:

`packages/protocol-ts/src/v1/helpers.ts`:
```ts
import type { Event } from './generated';

export function isEvent<T extends Event['type']>(
  e: Event,
  t: T
): e is Extract<Event, { type: T }> {
  return e.type === t;
}

export function ulid(): string { /* … */ }
```

`packages/protocol-rs/src/v1/helpers.rs`:
```rust
use super::generated::*;

impl AssessmentFinding {
    pub fn identity_hash_inputs(&self) -> String { /* … */ }
}
```

Codegen never touches helpers. `src/v1/mod.rs`:
```rust
pub mod generated;
pub mod helpers;
pub use generated::*;
```

**Exit**: `v1::ProtocolVersion::V1` and helper imports work from consumers.

### S5 — Round-trip test (0.2 day)

```ts
// packages/protocol-ts/tests/roundtrip.test.ts
import { readFileSync, readdirSync } from 'fs';
import { isEvent, /* etc */ } from '../src/v1/helpers';

describe('round-trip', () => {
  const samples = readdirSync('../protocol/v1/_samples', { recursive: true });
  for (const s of samples.filter(f => f.toString().includes('valid-'))) {
    test(s, () => {
      const parsed = JSON.parse(readFileSync(s, 'utf8'));
      // Type assertion here; real round-trip via canonical JSON.
      const serialized = JSON.stringify(parsed);
      expect(JSON.parse(serialized)).toEqual(parsed);
    });
  }
});
```

Rust:
```rust
// packages/protocol-rs/tests/roundtrip.rs
#[test]
fn assessment_finding_valid_minimal_roundtrips() {
    let raw = std::fs::read_to_string("../protocol/v1/_samples/assessment_finding/valid-minimal.json").unwrap();
    let parsed: AssessmentFinding = serde_json::from_str(&raw).unwrap();
    let serialized = serde_json::to_string(&parsed).unwrap();
    // Normalize both sides for canonical compare
    let canon_in: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let canon_out: serde_json::Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(canon_in, canon_out);
}
```

Fail on any drift. Reveals encoder/decoder mismatches.

**Exit**: all `valid-*` samples round-trip in both languages.

### S6 — CI drift check (0.2 day)

`scripts/verify-codegen.sh` already exists; now wire it to real:

```bash
bash scripts/codegen.sh
if ! git diff --exit-code --quiet -- packages/protocol-ts/src/v1/generated packages/protocol-rs/src/v1/generated; then
  echo "Generated code drifted. Run scripts/codegen.sh locally and commit."
  exit 1
fi
```

CI `codegen-check.yml` workflow already runs this.

Test: deliberately edit a schema without regenerating → PR fails.

**Exit**: drift detection proven live.

### S7 — Package exports (0.1 day)

Update `packages/protocol-ts/src/index.ts`:
```ts
export * from './v1/generated';
export * from './v1/helpers';
export const PROTOCOL_VERSION = 1 as const;
```

`packages/protocol-rs/src/lib.rs`:
```rust
pub mod v1;
pub use v1::*;
```

Make web + bridge able to `import { AssessmentFinding } from '@vac-web/protocol';` or `use protocol_rs::AssessmentFinding;`.

**Exit**: consumer smoke test in `apps/web` imports + uses a type; TS compiles.

## Deliverables

```
packages/protocol-ts/
├── src/
│   ├── index.ts                        # re-exports
│   └── v1/
│       ├── generated/                  # auto-generated
│       │   ├── index.ts
│       │   ├── capability_profile.ts
│       │   ├── assessment_finding.ts
│       │   └── ...
│       └── helpers.ts                  # hand-authored
├── tests/roundtrip.test.ts
└── package.json (with ajv/typescript deps)

packages/protocol-rs/
├── src/
│   ├── lib.rs
│   └── v1/
│       ├── mod.rs
│       ├── generated/                  # auto-generated
│       │   ├── mod.rs
│       │   ├── capability_profile.rs
│       │   └── ...
│       └── helpers.rs
└── tests/roundtrip.rs
```

## Exit criteria (gate to Phase 0.5)

- [ ] `scripts/codegen.sh` produces deterministic output (byte-identical across runs).
- [ ] `pnpm --filter @vac-web/protocol build` green.
- [ ] `cargo build -p protocol-rs` green.
- [ ] All `valid-*` samples round-trip in TS + Rust.
- [ ] CI drift check active and tested.
- [ ] `apps/web` imports a type from `@vac-web/protocol` and uses it.

## Risks

| Risk | Mitigation |
|---|---|
| Generator output non-deterministic (ordering) | Post-sort JSON keys; run through prettier/rustfmt deterministically |
| Helpers accidentally regenerated | Separate dirs: `generated/` (output) vs direct `*.ts`/`*.rs` sibling (helpers) |
| Drift check noisy on whitespace | Normalize via prettier + rustfmt before commit |
| `typify` behind draft 2020 spec | Pin version; report issues upstream; fallback to `schemafy` if blocked |
| Discriminated union ergonomics | Post-process generator output with a small TS/Rust transform if needed |

## Day-by-day

### Day 1
- Morning: S1 tool selection + prototype (evaluate 2 TS + 2 Rust candidates on `assessment_run.schema.json`).
- Afternoon: S2 TS generator + first iteration with helpers.

### Day 2
- Morning: S3 Rust generator + round-trip test.
- Afternoon: S4/S5/S6 — helpers, drift check, CI integration.

## Related

- [`docs/plans/phase-0.5/02-codegen-pipeline.md`](../phase-0.5/02-codegen-pipeline.md) — granular tasks.
- [`docs/architecture.md §12`](../../architecture.md) — versioning policy.
- Phase 0.2 — schemas (input).
- Phase 0.5 — upstream VAC `vac schema dump` produces parallel set; drift check compares both.

## Handoff to Phase 0.5

Red-team harness + upstream VAC PRs rely on the generated Rust types being importable in `tests/red-team/` (for crafting test envelopes) and in `local-bridge/` (for enforcement). Phase 0.5 assumes Phase 0.4 produces real types, not stubs.
