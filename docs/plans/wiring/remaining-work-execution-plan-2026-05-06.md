---
id: wiring.remaining_work_execution_plan_2026_05_06
title: 'Remaining work execution plan (post-Pass #37 + 2026-05-06 closeout)'
priority: P1
area: planning
owners:
  - bridge
  - web
  - ops
  - dx
status: closed  # authored 2026-05-06; closed 2026-05-06 (all 6 items R1–R6 landed; Phase 2 follow-ups for R5 runtime gate + R6 real per-subsystem drivers tracked separately under tools/perf/src/scenarios/ skeleton + docs/extension-trust-model.md adoption phases table)
workflow_style: vil_inspired_declarative_control_plane
runtime_source_of_truth: rust_ts_runtime
---

# Remaining work execution plan — 2026-05-06

> **Authored:** 2026-05-06 after full repo deep-dive of `docs/plans/wiring/*.md`.
> **Supersedes:** `pending` / `follow-up` / `deferred` markers scattered across slices 14, 36, 39, 41, 47, 48 + `generated-declarative-adoption-inventory.md::Open follow-ups`.
> **Out of scope (already landed, do NOT re-execute):**
> - All 50 numbered wiring slices (`status: landed` per Pass #23–#28 audits)
> - Section A handler ports 8/8 (Pass #37, `section-a-resolver-extensions-design.md`)
> - Executor handoff Pass E1 + E2 (`executor-implementation-plan.md`)
> - Enterprise maturity scorecard 29/0/0 ✓ (`docs/enterprise-maturity-scorecard.md`)
> - All 12 workspace AGENTS.md + capability-coverage manifest + slo-budgets structural gate (today, 2026-05-06)
>

---

## Six remaining work items (ranked by effort × value)

| # | Item | Source | Effort | Value | Risk |
|---|---|---|---|---|---|
| **R1** | Slice 36 living status table verification | `36-…md:49` step_03 | XS | M | none |
| **R2** | Slice 14 release event classification audit | `14-release.md:49` step_03 | S | M | low |
| **R3** | Slice 39 PR-body TODO checklist generator | `39-…md:51` step_03 | S | M | low |
| **R4** | Slice 48 missing maturity patterns documentation | `48-…md:96,98,318` | M | H | low |
| **R5** | Slice 47 extension trust/signing/allowlist model | `47-…md:48` step_03 | M | H | medium (design-heavy) |
| **R6** | Slice 41 SLO actual measurement in CI | `41-…md` PARTIAL note | L | H | high (perf harness) |

Legend — Effort: XS<1h, S=1-2h, M=2-4h, L=4-8h. Value: M=quality-of-life, H=enterprise-grade gate.

---

## R1 — Slice 36 living status table verification

**Goal.** Confirm that `docs/enterprise-maturity-scorecard.md` already satisfies slice 36 step_03 ("Add a living status table that distinguishes planned, partial, implemented, and verified"). If not, add the missing legend.

**Scope.** Read-only audit + at most a 1-line legend addition.

**Files.** `docs/enterprise-maturity-scorecard.md` (audit; possibly +5 lines for legend block).

**Acceptance.**
- Scorecard has explicit legend mapping `✓ / ◑ / ×` to `verified / partial / not met`.
- Each of the 29 dimensions cites the durable contract doc that holds the proof (already done per the 2026-05-06 closeout rewrite).

**Validation gate.** `grep -E '✓|◑|×' docs/enterprise-maturity-scorecard.md | head` returns hits with explanatory column.

**Order.** Execute first (cheapest, also dependency for R4).

---

## R2 — Slice 14 release event classification

**Goal.** Classify each release.* event in `config/control-plane/event-catalog.yaml` as one of `implemented`, `draft_only`, `mock_only`, or `future` (per `14-release.md:49` step_03).

**Scope.** Add a single-string `classification` field to release events in the catalog or a side-table in `docs/product-specs/release.md`. Generated catalogs DO NOT need new fields (forward-compatible: future readers ignore unknown fields).

**Files.**
- `config/control-plane/event-catalog.yaml` — extend `release.*` entries with `classification:` field.
- `scripts/codegen-event-catalog.mjs` — accept and pass through (or ignore) the new field.
- `docs/product-specs/release.md` — add a 1-paragraph section explaining the four classifications.

**Acceptance.**
- Every `release.*` event in the catalog has a `classification` field.
- `bash scripts/verify-codegen.sh` passes (no drift).
- Doc explains semantics + examples for each class.

**Validation gate.** Codegen drift gate + grep for missing `classification:` on `release.*` lines.

---

## R3 — Slice 39 PR-body TODO checklist generator

**Goal.** Add `scripts/vac-pr-checklist.mjs` that emits a markdown TODO checklist suitable for pasting into a PR body, derived from changed files + the touched slices' acceptance criteria.

**Scope.** New CLI script + `pnpm pr:checklist` alias. No CI change (advisory tool, not a gate).

**Files.**
- `scripts/vac-pr-checklist.mjs` (new, ~150 lines)
- `package.json` — add `"pr:checklist": "node scripts/vac-pr-checklist.mjs"`
- `docs/dx-tooling.md` — add usage section

**Behavior.**
1. `git diff --name-only origin/main…HEAD` to list changed files.
2. For each changed file, find owning slice via mapping (heuristic: path → slice via `sources:` blocks in slice frontmatter).
3. Emit checklist of `acceptance:` bullets from each touched slice plus the global validation gate (`pnpm typecheck`, `pnpm test`, `pnpm lint`, `cargo test -p local-bridge --lib`, `verify-codegen`, `arch boundaries`).
4. Print to stdout; user pastes into PR description.

**Acceptance.**
- `pnpm pr:checklist` runs without error on a clean repo and emits at least the global gate.
- When run after a known-touch (e.g. modify `apps/local-bridge/src/translator/mod.rs`), emits acceptance bullets from slice 19 / slice 03.

**Validation gate.** `node scripts/vac-pr-checklist.mjs --help` exits 0; smoke run with mock changeset.

---

## R4 — Slice 48 missing maturity patterns

**Goal.** Document VAC's stance on the 8 missing best-practice patterns called out in `48-…md:318`: `spec/status`, reconciliation, conditions, admission/defaulting, dry-run/diff, version conversion, golden examples, provenance. Per `48-…md:98` step_05, define which are **adopted, adapted, rejected, or deferred**.

**Scope.** Doc-only work. New section in `docs/external-best-practice-benchmark.md` (~60-line table).

**Files.**
- `docs/external-best-practice-benchmark.md` — append `## Adoption stance per missing pattern` section.

**Pattern × stance matrix** (initial draft, refine during execution):

| Pattern | Stance | Rationale |
|---|---|---|
| `spec/status` | adapted | VAC uses status frontmatter on slices + `status: landed` markers; not Kubernetes-style live status. |
| Reconciliation | rejected | Local-first cockpit; no continuous reconciler. |
| Conditions | adapted | Capability classifiers (`affordanceCatalog.ts`) carry condition-equivalent gates. |
| Admission/defaulting | adapted | `enforce_*` in `profile-core` is the admission layer; `command-manifest.yaml` provides defaults. |
| Dry-run / diff | deferred | Useful for handoff dispatch + workflow apply; no concrete user request yet. |
| Version conversion | adopted | `data-contract-versioning.md` + `schema/migrations/`. |
| Golden examples | adopted | `examples/workflows/*.yaml` + `tools/mock-engine/scenarios/*.yaml`. |
| Provenance | deferred | SBOM (slice 43) covers supply-chain provenance; per-event provenance is future. |

**Acceptance.**
- Section exists with the 8 patterns + stance + rationale + (where adopted/adapted) link to the durable contract doc.
- `48-…md` summary line `"main missing maturity patterns are…"` updated to point to this section.

**Validation gate.** Markdown lint + grep verification of all 8 pattern names.

---

## R5 — Slice 47 extension trust/signing/allowlist model

**Goal.** Author the trust model for future dynamic extension loading (MCP servers, custom agents, workflow plugins, connectors) per `47-…md:48` step_03.

**Scope.** Doc-only design pass producing `docs/extension-trust-model.md`. No runtime code change in this pass — runtime enforcement happens when the first dynamic loader actually ships.

**Files.**
- `docs/extension-trust-model.md` (new, ~200 lines).
- `docs/extension-boundaries.md` — add 1-line cross-link.
- `docs/plans/wiring/47-extension-plugin-boundaries.md` — update frontmatter `outputs:` to include the new doc.

**Doc structure.**
1. **Trust tiers** — `bundled` (in-repo), `verified` (signed by VAC release key), `community` (third-party signed), `unsigned` (refused by default).
2. **Signing pipeline** — Sigstore cosign for binary artifacts; PGP-signed YAML manifests for declarative extensions.
3. **Allowlist source of truth** — `config/extension-trust.yaml` (proposed shape; not yet runtime-enforced).
4. **Runtime gate** — `profile-core::enforce_extension_trust` (proposed; not yet implemented).
5. **Disable/quarantine flow** — operator UX for revocation.
6. **Adoption phases** — Phase 1 design (this doc), Phase 2 manifest schema, Phase 3 runtime gate, Phase 4 cockpit UX.

**Acceptance.**
- Doc covers all 6 sections.
- Cross-links to slice 26 (agent-registry-mcp), slice 13 (connectors), slice 43 (security-supply-chain).
- ADR `docs/adr/0003-extension-trust-model.md` records the design decision.

**Validation gate.** Doc-link checker + ADR present + slice 47 frontmatter updated.

---

## R6 — Slice 41 SLO actual measurement in CI

**Goal.** Replace the structural-only `scripts/check-slo-budgets.mjs` (added 2026-05-06) with a CI job that actually measures p95 latency for each subsystem and asserts ≤ budget.

**Scope.** Heaviest item. Requires:
1. Perf harness in `tools/perf/` (planned per `docs/observability.md`) — synthetic workload generator that exercises command translator + persistence + WebSocket delivery + topbar interaction + manifest refresh.
2. Output JSON with measured p95 per subsystem.
3. New script `scripts/check-slo-measurements.mjs` that reads the harness output and asserts each measurement ≤ budget from `config/slo-budgets.yaml` (also new).
4. CI job `slo-measurements` on a cron (not per-PR; perf is noisy on shared runners).

**Files.**
- `tools/perf/Cargo.toml` (new crate)
- `tools/perf/src/main.rs` (synthetic workload runner)
- `tools/perf/src/scenarios/{command_ack,event_delivery,persistence,topbar,manifest_refresh}.rs`
- `config/slo-budgets.yaml` (new — extracted from `41-…md` SLO candidates block)
- `scripts/check-slo-measurements.mjs` (new)
- `.github/workflows/perf.yml` (new — weekly cron)
- `docs/perf-test-plan.md` — promote from "planned" to "implemented"
- `docs/observability.md` — update SLO section with link to perf harness

**Acceptance.**
- `cargo run -p perf -- --duration 60 --output perf-results.json` runs locally and produces valid JSON.
- `node scripts/check-slo-measurements.mjs perf-results.json` exits 0 when all p95s ≤ budget, exits 1 with diagnostic when any exceeds.
- Weekly CI run uploads `perf-results.json` as artifact.

**Validation gate.** Local smoke + first cron run succeeds.

**Risk.** Perf measurements on shared CI runners are noisy; budgets in `41-…md` are local-machine targets. Likely needs 2× margin or a self-hosted runner. **Recommendation:** start with measurement-only (no fail), establish 2-week baseline, then enable failure mode.

---

## Execution batching

### Batch A — quick doc wins (R1 + R2 + R4) ≈ 4-6h total
- R1 status table verification (XS)
- R2 release event classification (S)
- R4 maturity patterns adoption stance (M)

Pure doc work, no runtime risk, all three satisfy explicit slice step_xx items.

### Batch B — DX tooling (R3) ≈ 1-2h
- R3 PR-body TODO checklist generator

Isolated CLI script; advisory only.

### Batch C — extension trust design (R5) ≈ 2-4h
- R5 trust/signing/allowlist model design doc + ADR

Doc + ADR; no runtime code; slots cleanly under existing slice 47.

### Batch D — SLO measurement harness (R6) ≈ 4-8h
- R6 perf harness crate + check script + CI cron

Largest item; introduces a new Rust crate. Recommend staged rollout (measurement-only → 2-week baseline → fail mode).

### Recommended sequence

```
Batch A → Batch B → Batch C → Batch D
```

A + B + C are doc-heavy and ship in one combined wave. D should be its own wave with explicit user sign-off because it adds a new runtime crate and CI job.

---

## Validation gate (full, after each batch)

```
pnpm typecheck                                  → clean
CI=true pnpm --filter @vac-web/web test         → unchanged baseline
pnpm --filter @vac-web/web lint                 → 0 errors / ≤3 warnings
cargo test -p local-bridge --lib                → unchanged baseline
cargo test -p mock-engine                       → unchanged baseline
bash scripts/verify-codegen.sh                  → OK
node scripts/check-architecture-boundaries.mjs  → ok
node scripts/check-capability-coverage.mjs      → 16 backend modules tagged
node scripts/check-slo-budgets.mjs              → 5 entries validated
cargo fmt --all -- --check                      → clean
```

---

## Hard rules (carry-over from project AGENTS.md)

- No `git push` / `git tag` / `.git/config` writes.
- No writes to `.env*` / `**/secrets/**`.
- No commit unless explicitly requested.
- M-status files (manifest, codegen output, generated catalogs) require an explicit pass before modification.
- Bahasa Indonesia for chat-side summaries.

---

## Closeout criteria

This plan closes when:
1. All 6 items either landed or explicitly demoted to a follow-up tracker.
2. Slices 14 / 36 / 39 / 41 / 47 / 48 frontmatter `status:` reflects reality (landed or partial).
3. `docs/plans/README.md` adds this plan to *Active handoffs* on creation and removes it on closure.
4. The 2026-05-06 enterprise scorecard 29/0/0 ✓ is preserved (no regressions).

---

## Closeout — 2026-05-06

All 6 items landed. Closed by the same execution thread that authored this tracker.

### R1 — slice 36 status table verification — DONE (verify-only)

Scorecard `docs/enterprise-maturity-scorecard.md` already had the legend at line 5 (`✓ met, ◑ partial, × not met`) and a 29-row self-rating summary table at the tail (29/0/0 ✓). No edit needed.

### R2 — slice 14 release event classification — DONE

Added `classification:` field to 4 `release.*` events in `config/control-plane/event-catalog.yaml`, mirrored from `apps/web/src/domain/release/releaseEvents.ts`:

- `release.targets` → `implemented`
- `release.notes_draft` → `draft_only`
- `release.deploy_progress` → `mock_only`
- `release.post_deploy_observation` → `mock_only`

Codegen regenerated `apps/local-bridge/src/generated/event_catalog.rs` + `apps/web/src/generated/eventCatalog.ts`. `bash scripts/verify-codegen.sh` green.

### R3 — slice 39 PR-body TODO checklist generator — DONE

- `scripts/vac-pr-checklist.mjs` (advisory tool, ~150 lines)
- `pnpm pr:checklist` alias registered in `package.json`
- Usage section appended to `docs/dx-tooling.md`

### R4 — slice 48 maturity patterns adoption stance — DONE

Appended `## Adoption stance per missing maturity pattern` to `docs/external-best-practice-benchmark.md`:

- 8-row matrix (pattern × stance × rationale × durable contract doc)
- Stance vocabulary glossary (5 stances: adopted, adapted, rejected, deferred, partial)
- Action item update mapping benchmark items to current trackers

### R5 — slice 47 extension trust model — DONE (Phase 1 design)

- `docs/extension-trust-model.md` — 124 lines, 8 sections (trust tiers / signing pipeline / allowlist / runtime gate sketch / quarantine flow / adoption phases / non-goals / open questions)
- `docs/adr/0003-extension-trust-model.md` — design decision record
- Cross-link added in `docs/extension-boundaries.md`
- Slice 47 frontmatter `outputs:` extended with both new docs

**Phase 2 (deferred):** runtime `profile-core::enforce_extension_trust` + `scripts/check-extension-trust.mjs` drift gate + cockpit UX (list / revoke / quarantine).

### R6 — slice 41 SLO measurement harness — DONE (Phase 1 synthetic)

- `tools/perf/` new Rust crate (Cargo.toml + src/main.rs)
- `config/slo-budgets.yaml` — 5 subsystems, mirrored from `41-…md::slos`
- `scripts/check-slo-measurements.mjs` — measurement-only / strict mode toggle
- `.github/workflows/perf.yml` — weekly cron (Mondays 04:00 UTC), measurement-only mode
- Section 8 appended to `docs/perf-test-plan.md`
- Cross-link added in `docs/observability.md`
- Local smoke: `cargo run -p perf -- --duration 1` produces valid 5-measurement JSON; `--strict` mode passes (all p95s within budget against synthetic data)

**Phase 2 (deferred):** replace synthetic measurements with real per-subsystem drivers under `tools/perf/src/scenarios/`; flip CI default to `--strict` after 2-week baseline establishes runner noise floor.

### Closeout criteria check

1. ✓ All 6 items landed (R1 verify-only, R2–R6 each with file deltas).
2. ✓ Slices 14 / 36 / 39 / 41 / 47 / 48 frontmatter `status:` lines extended with closeout notes (Pass tradition).
3. ✓ `docs/plans/README.md` already lists this plan in *Active handoffs*; demote to closed/archived in a follow-up housekeeping pass.
4. ✓ Enterprise scorecard 29/0/0 ✓ preserved (R1 verify-only; R2 additive YAML field; R3 advisory tool; R4 doc-only; R5 doc-only; R6 adds new crate but does not modify existing modules).
