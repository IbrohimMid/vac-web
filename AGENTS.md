# vac-web — agent guide

End-to-end software delivery cockpit. Local-first, browser-driven; assessor/executor split.

## Workspaces

- `apps/local-bridge` — Rust axum WS bridge (translator, session, audit, profile, handoff). [AGENTS.md](apps/local-bridge/AGENTS.md)
- `apps/relay-service` — Rust relay for cross-host bridging. [AGENTS.md](apps/relay-service/AGENTS.md)
- `apps/web` — React UI cockpit. [AGENTS.md](apps/web/AGENTS.md)
- `packages/bridge-core` — Rust shared bridge primitives. [AGENTS.md](packages/bridge-core/AGENTS.md)
- `packages/protocol-rs` — Rust generated protocol types. [AGENTS.md](packages/protocol-rs/AGENTS.md)
- `packages/protocol-ts` — TS generated protocol types. [AGENTS.md](packages/protocol-ts/AGENTS.md)
- `packages/profile-core` — Rust profile evaluation engine. [AGENTS.md](packages/profile-core/AGENTS.md)
- `tools/codegen` — Rust + Node codegen toolchain. [AGENTS.md](tools/codegen/AGENTS.md)
- `tools/mock-acp` — Mock ACP harness. [AGENTS.md](tools/mock-acp/AGENTS.md)
- `tools/mock-engine` — Mock execution engine. [AGENTS.md](tools/mock-engine/AGENTS.md)
- `tests/integration` — Integration test crate. [AGENTS.md](tests/integration/AGENTS.md)
- `tests/red-team` — Red-team test crate. [AGENTS.md](tests/red-team/AGENTS.md)

## Hard rules for agents

1. Runtime authority is Rust + TS code. YAML control plane describes intent only.
2. Never edit `.env*` or `**/secrets/**`.
3. Never `git push` / `git tag` / write to `.git/config`.
4. Codegen output is read-only — re-run the generator instead of hand-editing.
5. Adding a backend module requires a capability tag in `config/capability-coverage.yaml` (CI gate `capability-coverage` enforces).

## Plan set

All 50 numbered wiring slices (01–50) landed by Pass #27 (2026-05-04). See `docs/plans/README.md` for active handoffs (currently: `executor-implementation-plan.md`, landed 2026-05-06).

## CI gates (must stay green)

Defined in `.github/workflows/ci.yml` and `security.yml`:

- Rust: `cargo fmt --check`, `clippy -D warnings`, `cargo build --workspace`, `cargo test --workspace`.
- Node: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test`, size-limit budget.
- Schema: `scripts/schema-validate.sh`, `scripts/manifest-verify.sh`.
- Architecture: `scripts/check-architecture-boundaries.mjs` (slice 37).
- Capability: `scripts/check-capability-coverage.mjs` (slice 1.2 + 5.1).
- SLO: `scripts/check-slo-budgets.mjs` (slice 8.3).
- Security: `cargo deny`, `cargo audit`, `pnpm audit`, gitleaks, CycloneDX SBOM.

## Scorecard

Maturity status tracked in `docs/enterprise-maturity-scorecard.md`. As of 2026-05-06: all 29 dimension entries ✓.
