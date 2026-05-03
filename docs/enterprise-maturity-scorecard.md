# Enterprise maturity scorecard (slice 36)

This is the bar for calling VAC Web mature, clean, enterprise-grade, and
maintainable. Each dimension has a target state and a current self-rating
(✓ met, ◑ partial, × not met).

## Dimensions

### 1. Architecture clarity

* Layered diagram exists (`docs/module-boundaries.md`). ✓
* Each module has an `AGENTS.md` or top-of-file doc explaining ownership. ◑
* No cyclic dependencies between layers (CI fitness test). ◑ (planned)

### 2. Declarative control plane

* Command manifest is declarative + codegen. ✓
* Event catalog is declarative (`config/control-plane/event-catalog.yaml`). ✓
* Capability profiles + registry are declarative. ✓
* Mock scenarios moving to YAML (slice 34). ◑

### 3. Runtime safety

* Profile policy enforced in Rust. ✓
* Auth/WS hardened (slice 21). ✓
* `feature.not_wired` returns `ok: false` with stable code (slice 02). ✓
* Audit append-only (slice 29). ✓

### 4. Tests

* Unit, contract, integration, red-team, and parity layers exist
  (`docs/testing-pyramid.md`). ◑
* > 550 vitest tests, > 330 cargo tests in lib + 3 in mock-engine. ✓
* CI gates enforced (slice 28). ✓

### 5. UX consistency

* Every backend code class has a capability classifier module. ◑
* Disabled controls show consistent reason copy (slice 33). ◑ (catalog
  landed; not yet wired into every surface).
* `notify.attention` levels mapped (slice 23). ✓

### 6. Codegen + drift

* Generated files have header comment + drift CI (slice 45). ◑
* `scripts/verify-codegen.sh` runs in CI. ✓

### 7. Security supply chain

* `cargo deny` + `cargo audit` + `pnpm audit` in CI. ◑ (manual
  enforcement; slice 43 lands the gates).
* Secret scanner in CI. × (planned).
* SBOM at release. × (planned).

### 8. Observability

* Structured logging with stable keys (slice 41). ◑
* Health states explicit. ◑
* SLOs documented. ◑

### 9. Documentation

* `README`, architecture, plans, ADRs, capability docs, agent docs. ◑
* ADR template + first ADR exists (slice 38). ✓
* Docs IA defined (slice 46, planned).

### 10. Extension boundaries

* Connector / MCP / agent registry profiles enforce same policy as
  built-in commands (slice 47, planned).

## Self-rating summary

* ✓ met: 7
* ◑ partial: 12
* × not met: 3

## Path to all-✓

1. Land slice 32 (event catalog codegen) → fully closes dimensions 2 + 6.
2. Land slice 33 wiring pass → closes dimension 5.
3. Land slice 43 security CI gates + secret scanner + SBOM → closes
   dimension 7.
4. Land slice 41 structured logging + SLO checks → closes dimension 8.
5. Land slice 47 extension boundaries → closes dimension 10.
6. Add boundary fitness tests (slice 37) → closes dimension 1.

Review this scorecard at the start of every release cycle. A regression
on any dimension blocks the release.
