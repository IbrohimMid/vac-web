# DX tooling and scaffolding (slice 39)

Goal: every common contributor task is one command. Agents/executors
can extend the system safely without grep-driven archaeology.

## One-command checks

| Task | Command |
| --- | --- |
| Format Rust | `cargo fmt --all` |
| Format TS | `pnpm format` _(planned)_ |
| Run all gates | `pnpm verify` _(planned wrapper)_ |
| Run codegen + drift check | `pnpm codegen:catalog && bash scripts/verify-codegen.sh` |
| Quick web tests | `pnpm --filter @vac-web/web test -- --run` |
| Quick bridge tests | `cargo test -p local-bridge --lib` |
| Mock-engine tests | `cargo test -p mock-engine` |
| Typecheck only | `pnpm --filter @vac-web/web typecheck` |
| Lint only | `pnpm --filter @vac-web/web lint` |

## Scaffolding scripts (planned)

* `scripts/vac-plan-new.mjs <slice-id> <title>` — creates
  `docs/plans/wiring/NN-<slice>.md` from the slice template with the
  required YAML control-plane block.
* `scripts/vac-command-new.mjs <command-id>` — inserts a stub entry in
  `command-manifest.yaml`, regenerates the catalog, and prints a
  TODO list for handler + UI wiring.
* `scripts/vac-capability-new.mjs <name>` — scaffolds
  `apps/web/src/domain/capabilities/<name>.ts` and `<name>.test.ts`
  with the canonical export shape.

Until the scripts land, follow the patterns in existing capability
modules (e.g. `notifyClass.ts`, `assessmentIndex.ts`).

## Naming conventions

* Capability modules: `<topic><Subject>.ts` (camelCase) under
  `apps/web/src/domain/capabilities/`.
* Each module exports:
  * A `*CopyFor()` or `classify*()` pure function.
  * An `is*Event()` predicate (where applicable).
  * A `*_CODES` / `*_EVENTS` array.
  * A `*_FALLBACK` constant.
* Every module has a sibling `<name>.test.ts`.

## TS strictness

* `tsconfig.json` enables `strict` and `exactOptionalPropertyTypes`.
* Optional fields must use `?: T | undefined`, not `?: T`.
* Discriminated unions over boolean flags whenever possible.

## Rust style

* Edition 2021. Format with `cargo fmt`.
* Clippy gate via `.run-clippy.sh` (planned to land in CI).
* No `unwrap()` / `expect()` in non-test code without a comment
  justifying it.

## Reviewer checklist

1. Did the slice add or update a capability module / test pair?
2. Are validation gates green locally?
3. Did the slice update the relevant `docs/plans/wiring/*.md` to
   `status: shipped` or `in_progress`?
4. If a public schema changed, did the PR include an ADR?
5. If a generated file changed, did the source change too?

## PR-body checklist generator (slice 39 step_03)

`scripts/vac-pr-checklist.mjs` emits a markdown TODO checklist suitable for pasting into a PR body, derived from changed files plus the touched wiring slices' acceptance bullets.

Usage:

```
pnpm pr:checklist                  # diff against origin/main
pnpm pr:checklist -- --base HEAD~1 # custom base ref
pnpm pr:checklist -- --help        # show help
```

The output is advisory — not a CI gate. Paste into your PR description and tick boxes as gates pass.
