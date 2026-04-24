# Plan 05 — Repo scaffold

**Phase**: 0.5 · **Depends on**: — · **Blocks**: all implementation · **Est**: 1 day

## Goal

Materialize the target repo layout with working build, lint, test, and CI. Nothing is implemented beyond hello-world stubs, but every plumbing piece is in place so subsequent plans can focus on content.

## Scope

### In
- Cargo workspace (Rust).
- pnpm workspace (Node).
- Hello-world apps: `local-bridge` serving a `/health`; `web` rendering an h1.
- Dev script running both concurrently.
- Lint + format + test for both languages.
- CI: build + test + codegen drift + schema validate.

### Out
- Actual protocol implementation.
- Actual UI.
- Actual profile enforcement (plan 10).

## Deliverables

```
vac-web/
├── Cargo.toml                # workspace
├── pnpm-workspace.yaml
├── package.json
├── rust-toolchain.toml       # pin stable
├── .gitignore
├── .editorconfig
├── .prettierrc
├── .eslintrc.cjs
├── rustfmt.toml
├── clippy.toml
├── tsconfig.base.json
├── apps/
│   ├── local-bridge/
│   │   ├── Cargo.toml
│   │   └── src/main.rs       # axum hello world
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       └── src/main.tsx
├── packages/
│   ├── protocol/             # already has v1/
│   ├── protocol-ts/
│   │   ├── package.json
│   │   └── src/index.ts      # stub export
│   └── protocol-rs/
│       ├── Cargo.toml
│       └── src/lib.rs        # stub
├── scripts/
│   ├── dev.sh
│   ├── codegen.sh
│   ├── verify-codegen.sh
│   └── manifest-verify.sh
├── tests/
│   └── red-team/             # from Plan 04
├── docs/                     # already populated
└── .github/workflows/
    ├── ci.yml
    ├── codegen-check.yml
    └── red-team.yml
```

## Stages

### S1 — Directory + basic configs (0.2 day)

- `git init` (if not yet).
- Top-level `Cargo.toml` workspace with members: `apps/local-bridge`, `packages/protocol-rs`, `tests/red-team`.
- `pnpm-workspace.yaml` with `apps/web` + `packages/protocol-ts`.
- `.gitignore` (Rust + Node + editor + OS).
- `rust-toolchain.toml`: `channel = "stable"`.
- `.editorconfig` standard.
- `rustfmt.toml` minimal (edition, max_width=100).
- `clippy.toml` strict enough to matter, not pedantic.
- `.prettierrc` + `.eslintrc.cjs` (extends `@tanstack/eslint-config`? decide).
- `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

**Exit**: `cargo check --workspace` + `pnpm install` both succeed.

### S2 — `local-bridge` hello world (0.2 day)

```rust
// apps/local-bridge/src/main.rs
use axum::{routing::get, Router, Json};
#[tokio::main]
async fn main() {
    let app = Router::new().route("/health",
        get(|| async { Json(serde_json::json!({"ok": true, "version": env!("CARGO_PKG_VERSION")})) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    println!("bridge listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}
```

Dependencies: `axum`, `tokio`, `serde`, `serde_json`, `tower`, `tower-http`.

**Exit**: `cargo run -p local-bridge` prints URL; `curl /health` returns JSON.

### S3 — `web` hello world (0.2 day)

`pnpm create vite apps/web --template react-ts` then:
- Strip boilerplate.
- `src/main.tsx`: render `<h1>vac-web</h1>` + `<p>bridge: {status}</p>` where status fetches `/health`.
- Configure `vite.config.ts` with proxy to localhost bridge (`/api` → `http://127.0.0.1:...`).
- Tailwind setup (install, postcss config, import in index.css).

**Exit**: `pnpm --filter web dev` serves on `:5173`, page shows bridge status.

### S4 — `scripts/dev.sh` (0.1 day)

```bash
#!/usr/bin/env bash
set -e
(cargo run -p local-bridge > /tmp/bridge.log 2>&1 &)
BRIDGE_PID=$!
trap "kill $BRIDGE_PID" EXIT
pnpm --filter web dev
```

Plus Makefile targets: `make dev`, `make test`, `make lint`, `make build`.

**Exit**: `./scripts/dev.sh` runs both, Ctrl+C clean shutdown.

### S5 — CI workflows (0.2 day)

`.github/workflows/ci.yml`:
- Rust: `cargo build --workspace`, `cargo test --workspace`, `cargo clippy -- -D warnings`, `cargo fmt --check`.
- Node: `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`.
- Cache: `Swatinem/rust-cache`, `actions/cache` for pnpm.

`.github/workflows/codegen-check.yml`: runs `scripts/verify-codegen.sh`.

`.github/workflows/red-team.yml`: from Plan 04.

Every workflow runs on `pull_request` + `push: main`.

**Exit**: all workflows green on initial commit.

### S6 — License + baseline docs (0.1 day)

- `LICENSE` (TBD — placeholder for now, note in `docs/product-prd.md §9 non-goals`).
- `CONTRIBUTING.md` brief: how to set up, run tests, what to read first (pointer to `docs/README.md`).
- `CODEOWNERS` skeleton.
- `.github/PULL_REQUEST_TEMPLATE.md` with checklist:
  - [ ] Docs updated if behaviour changed.
  - [ ] Schema regenerated if schema edited.
  - [ ] Red-team cases added if security boundary touched.
  - [ ] Perf baseline OK.

**Exit**: PR template visible in GitHub UI on draft PR.

### S7 — Version pinning (0.1 day)

Decide + pin versions:
- Rust toolchain (`rust-toolchain.toml`).
- Node (`.nvmrc` or `package.json` `engines`).
- pnpm (`packageManager` in `package.json`).
- Core dependencies with exact versions first-pass (to be relaxed later if needed).

Document rationale in `docs/architecture.md §12` or add `docs/tooling.md` (optional).

**Exit**: `rustup show`, `node --version`, `pnpm --version` match declared.

## Testing

- Hello-world builds on fresh clone + CI.
- `scripts/dev.sh` smoke test.
- CI workflows pass.

## Exit criteria

- [ ] Fresh `git clone` + `pnpm i` + `cargo build --workspace` succeeds in < 5 min.
- [ ] `./scripts/dev.sh` serves both; browser shows bridge health.
- [ ] All CI workflows green.
- [ ] PR template visible.

## Risks

| Risk | Mitigation |
|---|---|
| Tool version drift between devs | rust-toolchain.toml + .nvmrc + packageManager pin |
| Vite + proxy misconfig | Documented proxy path in `docs/architecture.md` |
| Workspace resolution quirks | `pnpm install --frozen-lockfile` required; single lockfile |
| CI too slow | Cache aggressively; parallel jobs |

## Related

- [`architecture.md`](../../architecture.md) §13 build & distribution
- Plan 02 — codegen (runs in CI)
- Plan 04 — red-team harness (runs in CI)
