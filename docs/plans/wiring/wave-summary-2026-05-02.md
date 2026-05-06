# Wave summary — 2026-05-02 (Wave -1 + Wave -2)

> ⚠️ **STALE — DO NOT USE FOR PLANNING.** Labeled 2026-05-06.
>
> **Status:** historical. Superseded by [`wave-summary-2026-05-03.md`](./wave-summary-2026-05-03.md). All slices (31–50) referenced here have since landed and been re-verified by Pass #23–#28 slice audits and the 2026-05-06 enterprise-maturity scorecard closeout (29/0/0 ✓). Retained only for git-archaeology / commit-lineage tracing. New work must NOT cite this file.

Snapshot of slices delivered in this autonomous execution batch. Use this
as the bridge between the wiring plans and what already landed on disk.

## Slices touched

| Slice | Title | Status (was → now) | Artifacts |
| --- | --- | --- | --- |
| 31 | Declarative pattern adoption audit | shipped | `docs/plans/wiring/generated-declarative-adoption-inventory.md` |
| 32 | Command + event catalog generation | partial → in_progress | `config/control-plane/event-catalog.yaml`, `scripts/codegen-event-catalog.mjs`, `apps/web/src/generated/eventCatalog.ts` (+test, 7), `apps/local-bridge/src/generated/event_catalog.rs`, `apps/local-bridge/src/generated/mod.rs`, drift gate in `scripts/verify-codegen.sh`, `package.json` `codegen:events` |
| 33 | Frontend declarative affordance catalog | catalog → catalog (no surface wiring this wave) | `apps/web/src/domain/capabilities/affordanceCatalog.ts` (+test, 7) |
| 34 | Mock scenario YAML | schema + 2 examples | `schema/mock-scenario.schema.json`, `tools/mock-engine/scenarios/*.yaml`, inventory doc |
| 35 | Workflow authoring rules | shipped | `examples/workflows/assess-index-rebuild.yaml`, `docs/workflow-authoring.md` |
| 36 | Enterprise maturity scorecard | shipped (doc) | `docs/enterprise-maturity-scorecard.md` |
| 37 | Module boundaries + layering | shipped (doc + skeleton) | `docs/module-boundaries.md`, `scripts/check-architecture-boundaries.mjs` |
| 38 | ADR governance | shipped | `docs/adr/README.md`, `docs/adr/0000-template.md`, `docs/adr/0001-declarative-control-plane.md` |
| 39 | DX tooling + scaffolding | shipped (doc + skeletons) | `docs/dx-tooling.md`, `scripts/vac-plan-new.mjs`, `scripts/vac-capability-new.mjs` |
| 40 | Error taxonomy + recovery | shipped (capability + schema) | `apps/web/src/domain/capabilities/errorTaxonomy.ts` (+test, 5), `schema/error-taxonomy.yaml` |
| 41 | Observability + SLOs | shipped (doc + schema) | `docs/observability.md`, `schema/observability-events.yaml` |
| 42 | Testing strategy pyramid | shipped (doc) | `docs/testing-pyramid.md` |
| 43 | Security + supply chain | shipped (doc) | `docs/security-supply-chain.md` |
| 44 | Data contract versioning | shipped (doc + skeleton) | `docs/data-contract-versioning.md`, `schema/migrations/README.md` |
| 45 | Generated code ownership | shipped (doc + manifest) | `docs/generated-code.md`, `tools/codegen/MANIFEST.json` |
| 46 | Docs information architecture | shipped (doc) | `docs/docs-governance.md` |
| 47 | Extension + plugin boundaries | shipped (doc) | `docs/extension-boundaries.md` |
| 48 | External best-practice benchmark | shipped (doc) | `docs/external-best-practice-benchmark.md` |
| 49 | Fixtures + scripts + repo hygiene | shipped (doc) | `docs/repo-hygiene.md` |
| 50 | Web rendering / worker pipeline | shipped (doc) | `docs/web-rendering-pipeline.md` |

## Validation snapshot (2026-05-02 23:35 Asia/Jakarta)

* `pnpm --filter @vac-web/web typecheck` — clean.
* `pnpm --filter @vac-web/web test -- --run` — **593 / 82** (was 581 / 80).
  Adds: errorTaxonomy (5), eventCatalog (7), affordanceCatalog (7).
* `pnpm --filter @vac-web/web lint` — **0 errors / 8 warnings** (baseline).
* `cargo check -p local-bridge` — clean (1 pre-existing unused-import
  warning in `capabilities.rs`).
* `node scripts/codegen-event-catalog.mjs --check` — OK.
* `node scripts/check-architecture-boundaries.mjs` — OK.

## Remaining work

* **Slice 32 codegen pipeline**: parity test that asserts every emitter
  in bridge / mock-engine references a known event id. (Requires a small
  rust integration test that loads `event_catalog::EVENT_CATALOG`.)
* **Slice 33 surface wiring**: import capability modules into `Topbar`,
  `SessionPicker`, `Toast/Notify`, transcript components.
* **Slice 34**: codegen pipeline producing
  `tools/mock-engine/src/generated/scenario_catalog.rs` from YAML
  directory and porting the remaining `scenarios.rs` entries.
* **Slice 37**: replace skeleton `check-architecture-boundaries.mjs`
  with a real import-graph walker and add to CI.
* **Slice 39**: implement the `vac-command-new.mjs` scaffold and wire
  the three scaffolders into a `pnpm scaffold:*` script set.
* **Slice 40**: codegen pipeline producing
  `apps/web/src/generated/errorTaxonomy.ts` and
  `apps/local-bridge/src/generated/error_taxonomy.rs` from
  `schema/error-taxonomy.yaml`, plus the bridge-side classifier consumer.
* **Slice 41**: bridge structured log emitter that validates against
  `schema/observability-events.yaml`.
* **Slice 43**: wire `cargo deny` / `cargo audit` / secret scanner /
  SBOM into CI.
* **Slice 50**: capability module(s) for transcript freeze + markdown
  pipeline, plus their tests.

## Notes for the next executor

* Do NOT commit unless the user explicitly asks.
* When you add a new generator, also wire it into `verify-codegen.sh`
  and `package.json` `codegen:*` scripts (pattern established this wave).
* Always re-run the full validation gate set before declaring a slice
  shipped:

  ```
  pnpm --filter @vac-web/web typecheck
  pnpm --filter @vac-web/web test -- --run
  pnpm --filter @vac-web/web lint
  cargo check -p local-bridge
  cargo test -p local-bridge --lib
  cargo test -p mock-engine
  ```
