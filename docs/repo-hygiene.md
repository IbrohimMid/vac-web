# Repository hygiene (slice 49)

Fixtures, scripts, schemas, and small support files that fall through
the broader DX/testing/config plans live here. This doc documents
ownership and rules so they stop drifting.

## Fixtures

* Location: `fixtures/`.
* Naming: `<slice-id>__<purpose>.<ext>` for slice-anchored fixtures;
  `<feature>__<scenario>.<ext>` otherwise.
* Every fixture has a sibling `README.md` if multiple files belong to
  the same scenario.
* Fixtures used by replay tests must include a `schema_version` field
  (slice 44).

## Scripts

* Location: `scripts/`.
* Conventions:
  * Filename = `<verb>-<object>.<ext>` e.g. `verify-codegen.sh`,
    `codegen-command-catalog.mjs`.
  * Top of file: short docstring + usage line.
  * No interactive prompts in CI scripts.
  * Exit codes: `0` ok, `1` fix-needed, `2` user-error.

## Schemas

* Location: `schema/`.
* Every schema file has a top-level `$id` and `$schema` set to the
  draft URL.
* Breaking changes follow `docs/data-contract-versioning.md`.

## Tests

* Integration tests under `tests/integration/` are owned by `qa`.
* Red-team tests under `tests/red-team/` are owned by `security`.

## Validation gates

* `pnpm lint` covers script style.
* `cargo fmt --check` covers Rust style.
* `bash scripts/verify-codegen.sh` covers generated drift.
* Schema files validate against their meta-schema.

## Cleanup follow-ups

1. Delete unused fixtures during release prep (with grep evidence).
2. Move ad-hoc shell scripts at repo root into `scripts/` with proper
   naming.
3. Add `scripts/README.md` listing every script and its owner.
