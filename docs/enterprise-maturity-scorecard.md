# Enterprise maturity scorecard (slice 36)

This is the bar for calling VAC Web mature, clean, enterprise-grade, and
maintainable. Each dimension has a target state and a current self-rating
(✓ met, ◑ partial, × not met).

## Dimensions

### 1. Architecture clarity

* Layered diagram exists (`docs/module-boundaries.md`). ✓
* Each module has an `AGENTS.md` or top-of-file doc explaining ownership. ✓ (13 AGENTS.md added in 2026-05-06 closeout: root + 12 workspace-level)
* No cyclic dependencies between layers (CI fitness test). ✓ (slice 37 landed; `scripts/check-architecture-boundaries.mjs`)

### 2. Declarative control plane

* Command manifest is declarative + codegen. ✓
* Event catalog is declarative (`config/control-plane/event-catalog.yaml`). ✓
* Capability profiles + registry are declarative. ✓
* Mock scenarios moving to YAML (slice 34). ✓ (Section A 8/8 complete; Pass #37, 2026-05-05)

### 3. Runtime safety

* Profile policy enforced in Rust. ✓
* Auth/WS hardened (slice 21). ✓
* `feature.not_wired` returns `ok: false` with stable code (slice 02). ✓
* Audit append-only (slice 29). ✓

### 4. Tests

* Unit, contract, integration, red-team, and parity layers exist
  (`docs/testing-pyramid.md`). ✓ (slice 42 landed)
* > 550 vitest tests, > 330 cargo tests in lib + 3 in mock-engine. ✓
* CI gates enforced (slice 28). ✓

### 5. UX consistency

* Every backend code class has a capability classifier module. ✓ (16 backend modules mapped in `config/capability-coverage.yaml`; CI gate `capability-coverage` enforces sync)
* Disabled controls show consistent reason copy (slice 33). ✓ (4 surfaces wired in 2026-05-03 wave: Topbar search, SessionPicker create, NotifyLanes dismiss, ToolCallBlock toggle).
* `notify.attention` levels mapped (slice 23). ✓

### 6. Codegen + drift

* Generated files have header comment + drift CI (slice 45). ✓ (slice 45 landed; `tools/codegen/MANIFEST.json`)
* `scripts/verify-codegen.sh` runs in CI. ✓

### 7. Security supply chain

* `cargo deny` + `cargo audit` + `pnpm audit` in CI. ✓ (slice 43 landed; CI gates enforced).
* Secret scanner in CI. ✓ (gitleaks job in `.github/workflows/security.yml`; ruleset in `.gitleaks.toml`)
* SBOM at release. ✓ (CycloneDX SBOMs for Rust + Node generated in `.github/workflows/security.yml` `sbom` job; uploaded as build artifacts)

### 8. Observability

* Structured logging with stable keys (slice 41). ✓ (slice 41 landed; 39/39 translator emit sites migrated; 102 audit/log_structured call sites in `apps/local-bridge/src`)
* Health states explicit. ✓ (4 states defined in `docs/observability.md`: `ok` / `degraded` / `unavailable` / `not_wired`; consumed by Topbar status chip + Toast lane via capability modules)
* SLOs documented. ✓ (5 SLO budgets in `docs/plans/wiring/41-observability-slos.md` + 5 SLO targets table in `docs/observability.md`; CI gate `slo-budgets` validates well-formedness via `scripts/check-slo-budgets.mjs`)

### 9. Documentation

* `README`, architecture, plans, ADRs, capability docs, agent docs. ✓ (87 docs verified in 2026-05-06 deep-dive)
* ADR template + first ADR exists (slice 38). ✓
* Docs IA defined (slice 46). ✓ (`docs/docs-governance.md`)

### 10. Extension boundaries

* Connector / MCP / agent registry profiles enforce same policy as
  built-in commands (slice 47). ✓ (slice 47 landed; `docs/extension-boundaries.md`)

## Self-rating summary

_Closed 2026-05-06 after full gap-remediation pass. All 29 dimension entries are now ✓._

* ✓ met: 29
* ◑ partial: 0
* × not met: 0

## Path to all-✓

_Closed 2026-05-06. All 29 dimension entries are now ✓._

The 2026-05-06 closeout pass shipped:

1. **Per-module `AGENTS.md`** — root + 12 workspace AGENTS.md files (`apps/`, `packages/`, `tools/`, `tests/`).
2. **Capability classifier coverage** — `config/capability-coverage.yaml` maps 16 backend modules; CI gate `capability-coverage` enforces sync with the filesystem.
3. **SLO budget validation** — CI gate `slo-budgets` parses the `slos:` YAML block in `docs/plans/wiring/41-observability-slos.md` and rejects malformed entries; 5 budgets validated.
4. **Secret scanner in CI** — gitleaks (already shipped in `.github/workflows/security.yml`; rating corrected on this pass after re-verification).
5. **SBOM at release** — CycloneDX (already shipped in `.github/workflows/security.yml`; rating corrected on this pass after re-verification).

Review this scorecard at the start of every release cycle. A regression
on any dimension blocks the release.
