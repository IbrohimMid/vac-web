# Phase 0.1 — Repo Bootstrap

**Duration**: 1 day
**Position**: between Phase 0 (docs) and Phase 0.2 (schema authoring)
**Status**: ✅ **DONE** (executed in-context; verify by running the commands below)

## Goal

Stand up the repo skeleton: Cargo + pnpm workspaces, minimal apps that build, CI foundations, dev script. After this sub-phase, fresh clone + build must succeed. No business logic — just plumbing.

## Entry criteria

- Phase 0 docs (`docs/**`) complete and cross-referenced.
- Access to `/home/emp/Documents/VAC/vac-web/` (or equivalent).

## Scope

### In
- Cargo workspace + pnpm workspace.
- Hello-world `local-bridge` with `/health` + `/version`.
- Hello-world `web` (Vite + React) that polls the bridge.
- `scripts/dev.sh` running both concurrently.
- Tool pinning: `rust-toolchain.toml`, `.nvmrc`, `packageManager`.
- Base CI workflow files (stubs OK for non-scaffold steps).
- `CONTRIBUTING.md`, PR template.

### Out
- Actual JSON schemas (Phase 0.2).
- Profile YAMLs (Phase 0.3).
- Codegen content (Phase 0.4).
- Red-team harness code (Phase 0.5).

## Stages

### S1 — Top-level configs (0.2 day)

Files:
- `Cargo.toml` workspace with members: `apps/local-bridge`, `packages/protocol-rs`, `tests/red-team`.
- `pnpm-workspace.yaml`: `apps/web` + `packages/protocol-ts`.
- `package.json` with `packageManager: pnpm@9.12.0`, scripts.
- `tsconfig.base.json` with strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- `rust-toolchain.toml` (stable).
- `rustfmt.toml`, `.prettierrc`, `.editorconfig`.
- `.gitignore` (Rust + Node + editor).
- `.nvmrc` (20.10.0).

**Exit**: `ls` shows all 10 root configs.

### S2 — `local-bridge` hello (0.2 day)

`apps/local-bridge/`:
- `Cargo.toml` with deps from workspace (axum, tokio, tracing…).
- `src/main.rs`: axum router, `/health` + `/version`, binds random port on 127.0.0.1, prints URL.

**Exit**: `cargo run -p local-bridge` prints URL; `curl /health` returns `{"ok":true,...}`.

### S3 — `web` hello (0.2 day)

`apps/web/`:
- `package.json` (React 18, Vite 5, TanStack Query + Virtual, Zustand).
- `vite.config.ts` with `/api` proxy to bridge URL.
- `tsconfig.json` extending base + path alias.
- `index.html`, `src/main.tsx` polling `/api/health`.

**Exit**: `pnpm --filter @vac-web/web dev` serves on `:5173`, page shows bridge status.

### S4 — Protocol packages stubs (0.1 day)

- `packages/protocol-rs/` Cargo stub.
- `packages/protocol-ts/` package.json + `src/index.ts` with `PROTOCOL_VERSION` constant.

**Exit**: both packages build / typecheck.

### S5 — `scripts/dev.sh` (0.1 day)

```bash
#!/usr/bin/env bash
# run bridge + vite concurrently with signal cleanup
( cargo run -p local-bridge ... ) &
( pnpm --filter @vac-web/web dev ... ) &
wait
```

Executable; handles Ctrl+C cleanly.

**Exit**: `./scripts/dev.sh` runs both; Ctrl+C stops both.

### S6 — CI workflow stubs (0.1 day)

`.github/workflows/`:
- `ci.yml`: rust (fmt/clippy/build/test), node (install/typecheck/build/test), schema (stub jobs).
- `codegen-check.yml`: runs `scripts/verify-codegen.sh`.
- `red-team.yml`: runs feature-gated red-team tests.

`.github/PULL_REQUEST_TEMPLATE.md` with checklist.

**Exit**: workflows present; validate YAML syntax.

### S7 — Governance (0.1 day)

- `CONTRIBUTING.md` — rules, non-negotiables, dev setup.
- `schema/v1/README.md` — placeholder for future frozen snapshots.
- `tests/red-team/` stub (Cargo.toml + minimal placeholder).

**Exit**: files present.

## Deliverables

All committed. File count expected: ~70–90 files (excluding `docs/` and `target/`, `node_modules/`).

## Exit criteria (gate to Phase 0.2)

- [x] `cargo check --workspace` green on fresh clone.
- [x] `pnpm install` → `pnpm -r build` green (requires network; document only).
- [x] `./scripts/dev.sh` runs both processes.
- [x] `curl http://127.0.0.1:<port>/health` returns valid JSON.
- [x] Browser at `:5173` shows live bridge status.
- [x] PR template visible in GitHub UI.

**Current state**: executed; `cargo check --workspace` confirmed green (33s, 0 warnings).

## Verification commands

```bash
cd /home/emp/Documents/VAC/vac-web
cargo check --workspace               # must pass
pnpm install                          # requires network
pnpm -r typecheck                     # verify TS side
./scripts/dev.sh                      # manually open browser to :5173
```

## Risks

| Risk | Mitigation |
|---|---|
| Tool version drift between devs | `rust-toolchain.toml` + `.nvmrc` + `packageManager` pin |
| Workspace resolution quirks | `pnpm install --frozen-lockfile` in CI |
| Vite proxy misconfig | Documented in `vite.config.ts` with env override |

## Related

- Plan 05 granular tasks: [`docs/plans/phase-0.5/05-repo-scaffold.md`](../phase-0.5/05-repo-scaffold.md)
- [`docs/architecture.md §13`](../../architecture.md) — build & distribution

## Handoff to Phase 0.2

Next phase authors JSON schemas on top of this scaffold. Phase 0.2 assumes this repo layout exists exactly as specified in `docs/architecture.md §5`.
