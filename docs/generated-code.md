# Generated code ownership and edit policy (slice 45)

## Rule

Generated files are **immutable by hand**. They are produced by codegen
scripts from declarative sources and verified by CI drift checks. If a
generated file looks wrong, fix the **source**, not the file.

## Identifying generated files

Every generated file MUST start with a header comment of the form:

```
// AUTO-GENERATED — DO NOT EDIT.
// Source: <relative path to YAML/JSON Schema input>
// Generator: <relative path to codegen script>
```

For TypeScript / Rust, use `//`. For YAML / JSON, use `#` or wrap in a
top-level comment / `$comment` field.

## Current inventory

| Generated file | Source | Generator |
| --- | --- | --- |
| `apps/local-bridge/src/generated/command_catalog.rs` | `config/control-plane/command-manifest.yaml` | `scripts/codegen-command-catalog.mjs` |
| `apps/local-bridge/src/generated/mod.rs` | generated Rust catalog modules | `scripts/codegen.sh` and catalog generators |
| `apps/web/src/generated/commandCatalog.ts` | `config/control-plane/command-manifest.yaml` | `scripts/codegen-command-catalog.mjs` |
| `apps/web/src/generated/eventCatalog.ts` | `config/control-plane/event-catalog.yaml` | `scripts/codegen-event-catalog.mjs` |
| `apps/web/src/generated/eventCatalog.test.ts` | `apps/web/src/generated/eventCatalog.ts` | hand-authored generated-output parity test |
| `apps/local-bridge/src/generated/event_catalog.rs` | `config/control-plane/event-catalog.yaml` | `scripts/codegen-event-catalog.mjs` |
| `apps/local-bridge/src/generated/error_taxonomy_catalog.rs` | `schema/error-taxonomy.yaml` | `scripts/codegen-error-taxonomy.mjs` |
| `apps/web/src/generated/errorTaxonomyCatalog.ts` | `schema/error-taxonomy.yaml` | `scripts/codegen-error-taxonomy.mjs` |
| `tools/mock-engine/src/generated/scenario_catalog.rs` | `tools/mock-engine/scenarios/*.yaml` + `schema/mock-scenario.schema.json` | `scripts/codegen-mock-scenarios.mjs` |
| `tools/mock-engine/src/generated/mod.rs` | generated mock-engine modules | `scripts/codegen-mock-scenarios.mjs` |

## Manifest

A machine-readable copy of the table above lives in
`tools/codegen/MANIFEST.json` (planned). CI uses it to:

1. Refuse a PR that edits a generated file without also updating the
   source.
2. Run drift checks: regenerate to a tmp dir and `diff` against the
   committed file.

## Drift CI gate

`scripts/verify-codegen.sh` runs each generator into a temp directory and
compares against the committed file. Any diff fails CI. Run locally
before committing:

```
pnpm codegen:catalog && bash scripts/verify-codegen.sh
```

## Deleting generated files

Never commit a deletion of a generated file unless the source has also
been removed. The drift check will refuse otherwise.

## Responsibility

* `protocol` owns codegen scripts under `tools/codegen/` and schema
  inputs under `packages/protocol/` and `schema/`.
* `dx` owns the manifest, the drift CI gate, and developer ergonomics
  scripts.
* Each consuming layer (bridge, web) owns wiring of generated code into
  its runtime.
