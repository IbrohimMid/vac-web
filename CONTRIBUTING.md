# Contributing to `vac-web`

Thanks for helping. This is a small, opinionated codebase with strict contracts.

## Before your first change

1. Read [`docs/README.md`](./docs/README.md) — 2 pages + point to relevant blueprint.
2. Read [`docs/product-prd.md`](./docs/product-prd.md) + [`docs/architecture.md`](./docs/architecture.md).
3. For security-adjacent work: [`docs/capability-profiles.md`](./docs/capability-profiles.md) is load-bearing. No exceptions.
4. For UI work: [`docs/frontend-rules.md`](./docs/frontend-rules.md) + [`docs/ux-grammar.md`](./docs/ux-grammar.md).

## Setting up

```bash
# Rust toolchain pinned via rust-toolchain.toml
# Node 20 (see .nvmrc), pnpm 9

pnpm install
cargo build --workspace
```

Run both in dev:

```bash
./scripts/dev.sh
```

## Project structure

See [`docs/architecture.md §5.1`](./docs/architecture.md) for bridge layout, [`docs/frontend-rules.md §12`](./docs/frontend-rules.md) for web.

Workspace crates to know:
- [`packages/profile-core/`](./packages/profile-core/) — capability profile loader + enforcement; shared between bridge + red-team. **Load-bearing security code.**
- [`packages/protocol-rs/`](./packages/protocol-rs/) — generated Rust types for protocol v1.
- [`tools/codegen/`](./tools/codegen/) — `vac-codegen` binary (JSON Schema → TS + Rust).
- [`tests/red-team/`](./tests/red-team/) — adversarial test suite. Every new capability PR must extend this.

## Regenerating types

Schema edits require regeneration + manifest update:

```bash
bash scripts/codegen.sh               # regenerate TS + Rust types
VAC_WEB_UPDATE_MANIFEST=1 bash scripts/manifest-verify.sh    # update hashes
```

CI fails on drift. Always commit schema + generated + manifest together.

## Work model

Execution follows [`docs/roadmap.md`](./docs/roadmap.md) and per-epic [`docs/plans/**`](./docs/plans/). Pick a plan; open a PR referencing it. Plans have explicit stages + exit criteria — make them real.

## Rules that are not negotiable

- **Never** expose VAC internal `InputEvent` / `OutputEvent` as wire types. Semantic protocol v1 only.
- **Never** allow an assessor profile to invoke a write-class tool. Red-team tests enforce.
- **Never** use `bash`/`shell` generic tools in assessor profiles — only `shell.exec_allowlisted`.
- **Never** mutate the `packages/protocol/v1/profiles/*.yaml` without bumping `PROFILES_MANIFEST.json` (CI blocks).
- **Never** use `dangerouslySetInnerHTML` without sanitization through `markdown/sanitize.ts`.
- **Never** import `redux` / `jotai` / Monaco-as-default (lint rules enforce).

If you think one of these needs an exception: open an issue first.

## Commit style

Conventional Commits recommended but not mandatory. Tie PRs to plans when applicable (`feat(plan-07): axum ws skeleton`).

## Getting help

File an issue with:
- What you're trying to do.
- What contract doc you're operating under.
- What's in your way.

We optimize for small, self-contained PRs that land docs-plus-code together.
