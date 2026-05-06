# tools/codegen

Rust + Node codegen toolchain. Generates protocol-rs, protocol-ts, command manifest, event catalog, error taxonomy, and mock scenarios.

## Run

```bash
bash scripts/codegen.sh             # full regenerate
bash scripts/verify-codegen.sh      # CI gate (.github/workflows/codegen-check.yml)
```

## Sources

- `packages/protocol/v1/*.schema.json` — protocol contracts.
- `config/control-plane/command-manifest.yaml` — command catalog.
- `config/control-plane/event-catalog.yaml` — event catalog.

## Outputs

All outputs carry the manifest header (slice 45). Drift-check enforced by `tools/codegen/MANIFEST.json`.

## Anti-patterns

- Hand-editing generated files (always re-run the generator).
- Adding a generator without registering it in `MANIFEST.json` (drift CI will pass spuriously).
