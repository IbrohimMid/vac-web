# `vac-web`

End-to-end software delivery cockpit: **build → assess → handoff → execute → reassess → release**, with an assessor/executor split that makes mutation require an approved handoff.

> Local-first agentic workspace + read-only specialist assessment swarms + formal handoff + release gates. Runs on your machine; the browser is the control plane.

## Status

**Phases 0–8 complete + post-v1 cockpit UX wiring + two rounds of trust-model hardening.** Steady-state.

| Layer | Surface |
| --- | --- |
| Foundations (0.x) | JSON Schemas v1, codegen (TS + Rust), profile-core, bridge-core, mock-engine, red-team harness |
| Bridge MVP (1.x) | axum WebSocket bridge, session manager, JSON-RPC translator, profile enforcement, JWT auth, audit |
| Cockpit core (2.x) | Markdown sanitize, Shiki worker, command palette (⌘K), notify lanes, overlay manager |
| Execution (3.x) | Workbench tabs (Approvals, Review+DiffViewer, Sessions, Runtime, Shell, Connectors, Mention) |
| Assessment (4.x) | Readiness Hub, virtualized findings, Gate system, freshness tiers (fresh/aging/stale/hard_expire) |
| Handoff loop (5.x) | Packet lifecycle, two-party signoff, pin mock, AssessmentDiff, convergence guard |
| Plane breadth (6.x) | 12-family assessor catalog, 6 gates, Release plane, Archive lenses, 14 connectors |
| Hosted dispatch (7.x) | `relay-service` blind router, bridge tunnel mode, QR pairing, device revocation, E2E scaffold |
| Continuous (8.x) | Trigger routing, debounce, regression detector, Guided wizard, Migration tab w/ strict trust |
| Cockpit UX (F5) | Release plane UI, Settings/Extensions tab, Perf badge, CI perf baseline wiring |
| Trust hardening | Audit-hardened `update_trust`, session-bound admin gate, structured audit, TOCTOU fix, two-party promotion approval, live perf telemetry |

Test surface: **97 vitest files / 677 tests** + cargo workspace (clippy `-D warnings` + fmt + nextest + doctests) + **4 drift checks** + red-team adversarial cases.

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-phase log.

## Quick start

Requirements: **Node 20.10+**, **pnpm 9+**, **Rust stable** (toolchain pinned via `rust-toolchain.toml`).

```bash
pnpm install                    # install Node deps
cargo build --workspace         # verify Rust side
pnpm dev                        # bridge + vite concurrently (alias for scripts/dev.sh)
```

Then open `http://localhost:5173`.

For hosted relay (Phase 7), set `VAC_RELAY_URL=ws://...` before launching the bridge; the web app picks up `?relay=…&device=…&session=…&token=…` URL parameters.

## Repo layout

```
vac-web/
├── apps/
│   ├── local-bridge/           # Rust axum WS bridge (translator, session, audit, profile, handoff, extensions, perf)
│   ├── relay-service/          # Rust blind router for cross-host bridging
│   └── web/                    # React + Vite cockpit (Workbench, ReadinessHub, Release, Settings)
├── packages/
│   ├── protocol/v1/            # JSON Schemas (canonical) + profile YAMLs + manifests + samples
│   ├── protocol-ts/            # generated TS types
│   ├── protocol-rs/            # generated Rust structs + round-trip tests
│   ├── profile-core/           # capability profile loader + enforcement primitives
│   └── bridge-core/            # shared Rust bridge primitives
├── tools/
│   ├── codegen/                # vac-codegen binary (JSON Schema → TS + Rust)
│   ├── mock-engine/            # scenario-driven mock execution engine
│   ├── mock-acp/               # mock ACP harness
│   └── perf/                   # synthetic perf harness (feeds .perf-baseline/history.jsonl)
├── tests/
│   ├── integration/            # cross-crate integration tests
│   └── red-team/               # adversarial profile-layer tests
├── config/
│   ├── control-plane/          # command-manifest.yaml + event-catalog.yaml (codegen sources)
│   ├── profiles/               # capability profile YAMLs (e.g. executor.release@1.0.0)
│   ├── gates/  agents/  sessions/  workflows/
│   ├── extension-trust.yaml    # runtime extension allowlist (read by local-bridge)
│   └── slo-budgets.yaml        # SLO budgets surfaced in CI
├── docs/                       # SSOT specs, ADRs (4), implementation plans
├── schema/                     # observability-events.yaml + frozen protocol snapshots
├── scripts/                    # dev.sh, codegen.sh, perf-baseline-*.mjs, check-*.mjs drift checks
└── .github/workflows/          # ci, codegen-check, perf, red-team, security
```

## Recent highlights

Latest cockpit-UX wiring + two trust-hardening rounds (May 2026):

- **Cockpit UX F5a/b/c (`5630598..1e9d8e2`)** — Release plane wired to 5 store-reading components, Settings/Extensions tab with `TrustActionMenu` + `QuarantineConfirmModal`, Topbar Perf badge, CI perf baseline archive + compare scripts.
- **Trust hardening — Round 1 (`5ab8563..7fc29a2`)** — `extensions.update_trust` audit hardening: admin gate, no silent auto-insert, restricted `revoked → allowed_*` transitions, structured audit emission, 5 new error codes, full doc cross-link (protocol §3.17/§4.14, ADR 0003, red-team §3.13).
- **Trust hardening — Round 2 (`dc2fb7f..1b886c8`)**
  - TOCTOU fix on the trust catalog (`fs2::FileExt::lock_exclusive` + tempfile atomic rename).
  - Audit migration to `audit::log_structured()` with a namespace allowlist (15 prefixes).
  - Session-bound admin gate via `profile_layer::enforce_action` — replaces the shared-secret env var with profile-class enforcement (no rotation/expiry concerns).
  - Live perf telemetry — `perf.latest_run` / `perf.run_completed` wired to the Topbar `PerfBadge` (status: ok / warn / crit, 25 % regression on a rolling 10-window).
  - Two-party promotion approval flow (`request_promotion` / `approve_promotion` / `list_approvals`) with proposer ≠ approver enforcement and per-approval state machine `pending → approved → applied`.

See [`docs/adr/0003-extension-trust-model.md`](./docs/adr/0003-extension-trust-model.md) for the trust contract.

## Documentation

See [`docs/README.md`](./docs/README.md) for the full index.

Core reads:
- [Product PRD](./docs/product-prd.md)
- [Architecture](./docs/architecture.md)
- [Protocol v1](./docs/protocol.md)
- [Capability Profiles](./docs/capability-profiles.md) — security boundary SSOT
- [Extension Trust Model](./docs/extension-trust-model.md) — admin gate, two-party approval, TOCTOU invariants
- [Evidence Freshness](./docs/evidence-freshness.md)
- [Red-team Test Plan](./docs/red-team-test-plan.md)

## Verification

```bash
# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace                    # fast default loop
cargo test --workspace                           # baseline + doctests
cargo test -p red-team --features redteam        # adversarial suite

# Web
pnpm -F web typecheck
pnpm -F web test                                 # vitest 677 tests
pnpm -F web build                                # vite production build

# Drift / governance gates
bash scripts/manifest-verify.sh                  # schema + profile hash drift
bash scripts/codegen.sh                          # regenerate TS + Rust types (deterministic)
node scripts/codegen-command-catalog.mjs --check
node scripts/codegen-event-catalog.mjs --check
node scripts/check-extension-trust.mjs           # extension allowlist schema check
node scripts/check-extension-trust-callsites.mjs # production callsite gate

# Perf baseline (CI also runs these)
node scripts/perf-baseline-archive.mjs perf-results.json
node scripts/perf-baseline-compare.mjs perf-results.json --window 14 --threshold 25
```

GitHub Actions: `ci`, `codegen-check`, `perf`, `red-team`, `security`. Dependabot enabled.

See [`CONTRIBUTING.md` § Testing](./CONTRIBUTING.md#testing) for the recommended Rust loop (nextest as fast default, `cargo test` retained as compatibility gate).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
