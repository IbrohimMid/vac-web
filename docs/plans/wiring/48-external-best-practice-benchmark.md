---
id: wiring.external_best_practice_benchmark
title: 'External best-practice benchmark for declarative control-plane architecture'
priority: P0
area: architecture-benchmark
owners:
  - architecture
  - bridge
  - web
  - protocol
status: landed  # Pass #25b audit: confirmed via artifacts ['docs/external-best-practice-benchmark.md']; 2026-05-06 R4 closeout: 8-pattern × stance matrix (adopted/adapted/rejected/deferred/partial) + vocabulary glossary + action item update appended to docs/external-best-practice-benchmark.md
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# External best-practice benchmark for declarative control-plane architecture

This plan benchmarks VAC Web's VIL-inspired declarative control-plane direction against mature open-source systems that use declarative resources, workflow-as-code, catalog-as-code, policy-as-code, and generated contracts.

The purpose is not to copy those projects. The purpose is to import proven architectural habits while keeping VAC Web's runtime truth in Rust/TypeScript.

## Workflow-as-code control plane

```yaml
slice: wiring.external_best_practice_benchmark
priority: P0
area: architecture-benchmark
owners:
  - architecture
  - bridge
  - web
  - protocol
depends_on:
  - wiring.enterprise_maturity_scorecard
  - wiring.declarative_pattern_adoption_audit
  - wiring.config_capabilities_control_plane
  - wiring.command_event_catalog_generation
sources:
  - docs/plans/wiring
  - apps/local-bridge/src
  - apps/web/src
  - packages/protocol/v1
  - config
  - schema
external_references:
  - name: Argo Workflows
    url: https://github.com/argoproj/argo-workflows
    relevant_patterns:
      - declarative workflow spec
      - controller reconciles desired state
      - workflow status/conditions
      - workflow templates and examples
  - name: Tekton Pipelines
    url: https://github.com/tektoncd/pipeline
    relevant_patterns:
      - CRD-style Task/Pipeline resources
      - status and results as first-class outputs
      - controller-owned reconciliation
      - supply-chain extension ecosystem
  - name: Crossplane
    url: https://github.com/crossplane/crossplane
    relevant_patterns:
      - declarative control-plane resources
      - composition as reusable orchestration
      - functions pipeline
      - desired/observed state separation
  - name: Backstage
    url: https://github.com/backstage/backstage
    relevant_patterns:
      - catalog-as-code
      - software templates/scaffolder
      - plugin boundaries
      - developer portal DX
  - name: Open Policy Agent
    url: https://github.com/open-policy-agent/opa
    relevant_patterns:
      - policy-as-code
      - data-driven policy evaluation
      - runtime enforcement separated from policy data
  - name: GitHub Actions Runner
    url: https://github.com/actions/runner
    relevant_patterns:
      - workflow command execution boundary
      - runner protocol and job lifecycle
      - hosted executor separation
  - name: Dagger
    url: https://github.com/dagger/dagger
    relevant_patterns:
      - programmable pipelines
      - typed SDK/codegen surface
      - reproducible dev workflows
steps:
  - id: step_01
    do: 'Map each external pattern to a VAC Web control-plane rule.'
  - id: step_02
    do: 'Add missing best-practice requirements to the split plan set.'
  - id: step_03
    do: 'Define which practices are adopted, adapted, rejected, or deferred.'
  - id: step_04
    do: 'Add CI/fitness tests where a practice can be enforced mechanically.'
acceptance:
  - 'Plan set explicitly covers spec/status, reconciliation, conditions, validation/defaulting, dry-run/diff, versioning/conversion, examples, provenance, and scaffolding.'
  - 'Every adopted external pattern has a VAC-specific boundary and source-of-truth owner.'
  - 'No external pattern grants runtime authority through YAML alone.'
validation_gates:
  - pnpm --filter @vac-web/web typecheck
  - pnpm --filter @vac-web/web test -- --run
  - pnpm --filter @vac-web/web lint
  - cargo check -p local-bridge
  - git diff --check
```

## Benchmark summary

| External system | What is mature there | VAC plan already has | Missing / needs upgrade |
|---|---|---|---|
| Argo Workflows | Declarative workflow spec, templates, status, controller execution. | Workflow YAML, Rust executor, event adapters. | Explicit `spec/status` split, condition taxonomy, reconciliation semantics. |
| Tekton Pipelines | Task/Pipeline CRDs, status/results, controller lifecycle, supply-chain ecosystem. | Workflow plan, CI gates, mock parity. | Results model, provenance/attestation, reusable task catalog. |
| Crossplane | Desired/observed state, compositions, functions pipeline, conditions. | Declarative control-plane and config capability plan. | Composition/function boundaries, observed-state cache, condition standards. |
| Backstage | Catalog-as-code, scaffolder templates, developer portal DX. | DX tooling/scaffolding plan. | Template governance, ownership metadata, golden-path examples. |
| OPA | Policy-as-code with runtime enforcement separation. | Profile-core policy and YAML/Rust boundary. | Policy test corpus and data/policy separation docs. |
| GitHub Actions Runner | Job lifecycle, runner/executor boundary, workflow command protocol. | Runtime jobs and shell boundary plans. | Job state machine, cancellation model, hosted/local executor distinction. |
| Dagger | Typed SDK/pipeline DX and reproducible workflows. | Codegen and scaffold plans. | More typed SDK ergonomics and local dev reproducibility docs. |

## Best-practice deltas to add to VAC plans

### 1. Spec/status split

Every declarative control-plane object needs a stable shape:

```yaml
apiVersion: vac.dev/v1
kind: CommandCapability
metadata:
  name: shell.start
spec:
  owner: bridge
  status: not_wired
  requiredProfileTool: shell.exec
status:
  observedGeneration: 3
  conditions:
    - type: Implemented
      status: "False"
      reason: NoBridgeExecutor
      message: shell.start is declared but not implemented by local-bridge yet.
```

Rule: `spec` is desired/configured state. `status` is bridge-observed runtime state. Users and YAML authors do not write `status`.

### 2. Reconcile loop semantics

YAML control-plane should not be one-shot config only. The bridge should have explicit reconciliation passes:

```yaml
reconcile:
  inputs:
    - commandCatalog.spec
    - bridgeHandlers.observed
    - frontendAffordances.spec
  outputs:
    - commandCatalog.status
    - system.capabilities
    - docs/generated inventories
```

This imports the controller pattern without requiring Kubernetes.

### 3. Conditions taxonomy

Adopt common condition style across plans, config, registry, workflows, connectors, releases, and gates:

```yaml
conditions:
  - type: Ready
    status: "True"
    allowedStatuses:
      - "True"
      - "False"
      - Unknown
    reason: HumanReadableMachineReason
    message: Operator-facing details.
    lastTransitionTime: timestamp
```

Core condition types:

```yaml
condition_types:
  - Ready
  - Validated
  - Reconciled
  - Implemented
  - WiredToUI
  - PolicyAllowed
  - Persisted
  - Degraded
```

### 4. Admission, validation, and defaulting

Before YAML is accepted by runtime:

- validate against JSON Schema;
- apply defaults deterministically;
- reject unknown fields unless explicitly versioned;
- normalize IDs;
- run semantic validation against runtime capabilities.

### 5. Dry-run and diff

For config/control-plane changes, add dry-run and diff before apply:

```yaml
operations:
  - config.validate
  - config.diff
  - config.apply
  - config.rollback
```

This matters for command manifest, registry, connectors, release targets, gates, workflows, and migration surfaces.

### 6. Versioning and conversion

All declarative resources need versioned API shape:

```yaml
apiVersion: vac.dev/v1alpha1
kind: WorkflowSpec
```

Plan for conversion before v1:

```yaml
conversion:
  from: vac.dev/v1alpha1
  to: vac.dev/v1beta1
  strategy: explicit_converter
```

### 7. Golden examples

Every control-plane resource type needs examples:

```text
examples/control-plane/command-capability/not-wired-shell-start.yaml
examples/control-plane/workflow/assess-index-rebuild.yaml
examples/control-plane/connector/local-health-only.yaml
```

Examples should be schema-tested and used by docs/tests.

### 8. Provenance and attestation

For generated catalogs and executable workflows:

```yaml
provenance:
  generatedBy: tools/codegen
  sourceDigest: sha256:...
  generatedAt: timestamp
  dirtyTreeAllowed: false
```

This should eventually align with supply-chain plans and generated-code ownership.

### 9. Ownership and plugin boundaries

Every declarative object should state owner and runtime boundary:

```yaml
owner: bridge
runtimeAuthority: rust
mutableBy:
  - config.reload
  - codegen
notMutableBy:
  - web_ui
  - provider_agent
```

### 10. Golden path scaffolding

Borrow Backstage-like scaffolder thinking: contributors should create new surfaces from templates, not memory.

```bash
pnpm vac:new control-plane command-capability shell.start
pnpm vac:new workflow assess.index.rebuild
pnpm vac:new affordance release.deploy.button
```

## Adopt / adapt / reject matrix

| Pattern | Decision | Rationale |
|---|---|---|
| Kubernetes CRD-like `spec/status` | Adopt | Excellent fit for declarative control-plane and observed bridge state. |
| Kubernetes API server/runtime | Reject | Too heavy; local bridge should not become Kubernetes. |
| Controller reconcile loop | Adapt | Use local Rust reconciliation passes, not cluster controllers. |
| Backstage scaffolder templates | Adopt | Strong DX fit for agent/executor productivity. |
| OPA policy-as-code | Adapt | Profile-core remains Rust policy engine; policy data may become declarative. |
| Dynamic workflow uploads | Defer/reject for now | Security model not mature enough; keep bundled/allowlisted specs. |
| Supply-chain attestations | Adopt gradually | Start with generated-code provenance and CI drift checks. |

## Required updates to existing plans

This benchmark strengthens existing plans:

- `27-config-capabilities-control-plane.md` must add spec/status, validation/defaulting, and dry-run/diff.
- `32-command-event-catalog-generation.md` must generate conditions/status inventories, not only constants.
- `39-dx-tooling-scaffolding.md` must add Backstage-like templates/golden paths.
- `44-data-contract-versioning.md` must add API version conversion rules for YAML resources.
- `45-generated-code-ownership.md` must add provenance metadata.
- `47-extension-plugin-boundaries.md` must require owner/runtimeAuthority on every extension object.

## Conclusion

The existing VAC plan set is directionally aligned with mature declarative systems. The main missing maturity patterns are `spec/status`, reconciliation, conditions, admission/defaulting, dry-run/diff, version conversion, golden examples, and provenance. Add those before declaring the repo enterprise-grade.
