# External best-practice benchmark (slice 48)

A short comparison of VAC Web against established patterns from
production systems we admire (and where we deliberately differ).

## Reference systems

* Bazel / starlark style for a constrained declarative control plane.
* LangChain / LangSmith for runtime telemetry granularity (without
  adopting their abstractions).
* OpenTelemetry semantic conventions for log key naming.
* Tauri for the local-process boundary.
* Sigstore / SLSA for supply-chain posture.

## Where we adopt

| Practice | Source | Adoption |
| --- | --- | --- |
| Declarative control plane with codegen + drift CI | Bazel / starlark, Buck2, Kubernetes API server | Slices 31–35, 45. |
| Append-only audit log with versioned schema | Multiple (Linux audit, GCP audit) | Slices 22, 29, 44. |
| Capability-based policy enforcement | Fuchsia, gVisor | `packages/profile-core`, slice 20. |
| Process boundary for local-bridge | Tauri | Architecture; slice 21. |
| OTel-style stable log keys | OpenTelemetry | Slice 41. |
| Generated code header + drift gate | Buck2, Bazel, prost | Slice 45. |

## Where we deliberately differ

* **No remote dependency for runtime.** VAC Web is local-first; we do
  not require a hosted control plane.
* **No in-process plugin loader.** Every extension is process-level or
  declarative (slice 47).
* **No DAG-style imperative workflow runtime in YAML.** Workflow YAML
  describes intent; runtime authority stays in Rust (slice 35).
* **No silent network I/O.** UI never calls third-party APIs directly;
  the bridge mediates and audits.

## Action items derived from the benchmark

1. Add `scripts/verify-codegen.sh` to CI (done) and tighten the diff
   check to a per-file granularity.
2. Adopt OTel semantic-convention key names (`event.name`, `enduser.id`)
   alongside our stable keys when external integrations land.
3. Adopt SLSA L1 in CI (provenance attestation) before any release.
4. Adopt sigstore/cosign signing for release artifacts.
5. Add a public ADR every time we deliberately differ from one of these
   reference systems.

## Validation cadence

* Re-run this benchmark at the start of each release cycle.
* Add new reference systems only with an ADR explaining why.

## Adoption stance per missing maturity pattern

Per slice 48 step_05 ("Define which practices are adopted, adapted, rejected, or deferred") and the closing summary of this benchmark which flagged 8 patterns missing from VAC's plan set, here is the explicit stance per pattern.

| Pattern | Stance | Rationale | Durable contract doc |
| --- | --- | --- | --- |
| `spec`/`status` separation | adapted | VAC uses `status:` frontmatter on each slice + per-event `status:` in the canonical catalog. Not Kubernetes-style live status reconciliation; static at-rest state suffices for a local-first cockpit. | `docs/plans/wiring/00-index.md`, `config/control-plane/event-catalog.yaml` |
| Reconciliation loops | rejected | Local-first cockpit; no continuous reconciler. State changes are command-driven, not desired-state-driven. ADR will be authored if/when the first reconciler need surfaces. | n/a |
| Conditions | adapted | Capability classifiers in `apps/web/src/domain/capabilities/*.ts` carry condition-equivalent gates (`canDeploy`, `canApprove`, `gateReady`, etc.). Not a generic boolean DSL. | `apps/web/src/domain/capabilities/`, slice 33 |
| Admission / defaulting | adapted | `enforce_*` functions in `packages/profile-core` provide admission. `command-manifest.yaml` provides defaults via codegen. Not Kubernetes-style mutating webhooks. | `packages/profile-core/src/lib.rs`, slice 20 |
| Dry-run / diff | deferred | Useful for handoff dispatch + workflow apply; no concrete user surface needs it yet. Tracked as a follow-up under `docs/plans/wiring/remaining-work-execution-plan-2026-05-06.md`. | follow-up |
| Version conversion | adopted | `docs/data-contract-versioning.md` + `schema/migrations/` define versioned schemas with codegen. | `docs/data-contract-versioning.md`, slice 44 |
| Golden examples | adopted | `examples/workflows/*.yaml` + `tools/mock-engine/scenarios/*.yaml` + golden test fixtures in `tools/mock-engine/tests/`. | `examples/workflows/`, `tools/mock-engine/scenarios/`, slice 35 |
| Provenance | partial | SBOM (slice 43) covers supply-chain provenance. Per-event provenance (who emitted, with what auth) is captured in audit logs (slice 29) but not a first-class field on every event. Tracked as a follow-up. | `.github/workflows/security.yml` (sbom job), `apps/local-bridge/src/audit/`, slice 29 + slice 43 |

### Stance vocabulary

- **adopted** — pattern implemented in VAC's preferred shape; durable contract doc exists.
- **adapted** — pattern's intent is met but the mechanism is intentionally different from the reference systems (smaller scope, no remote dependency, etc.).
- **rejected** — pattern is intentionally not adopted; ADR will be authored if/when reconsideration is needed.
- **deferred** — pattern is acknowledged as valuable but no concrete user surface needs it yet; tracked as a follow-up.
- **partial** — pattern is adopted in some scope but missing in others; expansion plan tracked.

### Action item update

Action item #4 of this benchmark ("Adopt sigstore/cosign signing for release artifacts") feeds into the trust-model design captured in `docs/extension-trust-model.md` (slice 47 follow-up, 2026-05-06) and ADR `docs/adr/0003-extension-trust-model.md`. Action item #3 ("Adopt SLSA L1 in CI") is pending; tracked under `docs/plans/wiring/remaining-work-execution-plan-2026-05-06.md` if release-cycle planning surfaces it.
