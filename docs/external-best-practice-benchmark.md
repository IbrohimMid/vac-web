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
