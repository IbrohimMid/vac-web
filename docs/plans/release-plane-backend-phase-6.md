---
id: plans.release-plane-backend-phase-6
title: 'Release plane backend executors (Phase 6)'
priority: P1
area: release-plane
status: draft
owners:
  - tools
  - web
created: 2026-05-10
depends_on:
  - plans/affordance-fake-feature-closeout-2026-05-10
  - plans/wiring/f4-refresh-plan-2026-05-09
---

# Release plane backend (Phase 6) — 2026-05-10

## Context

PRD §7 phase matrix menempatkan **Release plane (Deploy, Publish, Runbooks)** di **Phase 6**. PRD §4.4 mendefinisikan 5 capability:

- **Deploy** → dispatch ke target deployment, butuh `ReadyToDeploy` gate pass.
- **Publish** → app store / web launch, butuh `ReadyToPublish` gate pass.
- **Runbooks** → generate + edit operational runbooks (under `executor.release` profile).
- **Release Notes** → auto-generate dari commits + handoffs + decisions.
- **Post-release Monitor** → attach Sentry/Datadog observations.

State sekarang (verified `main` 2026-05-10):
- **Frontend**: 5 React komponen (`ReleasePanel`, `TargetCard`, `DeployProgressList`, `NotesDraftView`, `ObservationsFeed`) sudah landed via cockpit-UX plan F5a. Store `useRelease` populated dari event handlers di `domain/release/handlers.ts`. **Affordance gating** baru landed via fake-feature closeout plan (2026-05-10) — semua mutating button disabled dengan operator copy.
- **Command catalog**: `release.list_targets`, `release.generate_notes`, `release.deploy`, `release.publish` semua **`status: not_wired`** di `config/control-plane/command-manifest.yaml`. Tidak ada executor di `apps/local-bridge/src/`.
- **Event catalog**: `release.deploy_progress`, `release.post_deploy_observation` `status: planned`, producer `mock-engine.release-deploy` (mock-only sekarang).
- **Gate system** (PRD §5): `DevComplete`, `ReadyToDeploy`, `ReadyToPublish` schemas ada di `useGates`. Sign-off + override **affordance-disabled** sampai gate backend wired (lihat Risiko #2).

Plan ini implement 4 executor command + 2 event producer real (replace mock), plus capability profile `executor.release`. **Tidak termasuk** Runbooks (defer ke plan terpisah karena terkait template engine).

## Scope

### In scope

1. **Capability profile `executor.release`** — file YAML di `config/capability-profiles/` (cek path eksisting `executor.code`). Kapabilitas:
   - `release.deploy` allowed
   - `release.publish` allowed
   - `release.generate_notes` allowed
   - `connector.write` denied untuk semua connector kecuali GitHub releases + Notion release notes (per PRD §4.5 "Write capability when explicitly enabled per profile").
   - Tidak ada filesystem write di luar `release-notes/` directory.

2. **Backend executors** di `apps/local-bridge/src/release/`:
   - `mod.rs`, `handlers.rs`, `targets.rs`, `deploy.rs`, `publish.rs`, `notes.rs`.
   - Persist state ke `state.toml` per session (atau session-scoped DB row). Schema migration via existing persistence pattern (cek `apps/local-bridge/src/session/persistence/`).
   - Audit log per dispatch: `release.deploy_dispatched`, `release.publish_dispatched`, `release.notes_generated` (append-only event di `audit.jsonl` mirror).

3. **Gate enforcement** sebelum dispatch:
   - `release.deploy` panggil `gate_evaluator::ensure(GateId::ReadyToDeploy)`. Kalau `state != pass` dan tidak ada `gate.override` aktif: return `feature.gated`.
   - `release.publish` idem dengan `ReadyToPublish`.
   - Two-party signoff verification untuk gate prod (PRD §5).

4. **Event producer real** (replace mock): saat `release.deploy` dispatch sukses, executor fire `release.deploy_progress` per phase (`queued` → `deploying` → `deployed/failed`). Mock engine tetap available untuk dev/test mode (controlled via env `VAC_RELEASE_MODE=mock|real`).

5. **Command manifest update**: 4 command status `not_wired` → `implemented`. Regenerate `command_catalog.rs` + `commandCatalog.ts` via codegen-check.yml workflow.

6. **Frontend**: cuma regenerate codegen + verifikasi affordance otomatis enabled (zero UI change required — yang terjadi adalah `commandStatus()` return `implemented`, affordance gate auto-pass).

7. **Tests**:
   - Rust: integration test per executor (mock target, assert event sequence + audit log).
   - Web: existing `TargetCard.test.tsx` update untuk assert button **enabled** saat command status implemented (pakai mock catalog injection).
   - Red-team: `tests/red_team/release_plane.rs` — assert assessor profile **tidak bisa** call `release.deploy` (capability denied at profile layer).

### Out of scope

- **Runbooks** — defer plan terpisah (template engine, markdown editor, dispatch ke `executor.release` runtime).
- **Post-release monitoring (Sentry/Datadog wiring)** — defer ke connector plane phase 7.
- **`release.list_targets`** — UI sekarang inject targets via store state (mock); plan ini tidak menambahkan dynamic target discovery dari config. Defer ke `release.list_targets` ringan plan setelah Phase 6 stabilize.
- **Multi-target parallel dispatch** — v1 satu target per call.
- **Rollback mechanism** — tracked di runbooks plan.

## Workflow-as-code control plane

```yaml
slice: release-plane-backend-phase-6
priority: P1
area: release-plane
owners:
  - tools
  - web
depends_on:
  - plans/affordance-fake-feature-closeout-2026-05-10
  - plans/wiring/f4-refresh-plan-2026-05-09
steps:
  - id: capability_profile
    do: 'Author config/capability-profiles/executor.release.yaml'
    file: config/capability-profiles/executor.release.yaml
  - id: rust_module
    do: 'Create apps/local-bridge/src/release/{mod,handlers,deploy,publish,notes,targets}.rs'
    file: apps/local-bridge/src/release/
  - id: persistence
    do: 'Schema migration for release_state table'
    file: apps/local-bridge/src/session/persistence/
  - id: audit_log
    do: 'Append release.* dispatch events to audit log'
    file: apps/local-bridge/src/observability.rs
  - id: gate_enforcement
    do: 'gate_evaluator::ensure() before deploy/publish'
    file: apps/local-bridge/src/gates/
  - id: event_producer
    do: 'Replace mock release.deploy_progress with real producer'
    file: apps/local-bridge/src/release/deploy.rs
  - id: manifest_update
    do: '4 commands not_wired -> implemented'
    file: config/control-plane/command-manifest.yaml
  - id: codegen_regenerate
    do: 'pnpm codegen + verify drift'
    file: apps/local-bridge/src/command_catalog.rs
  - id: rust_tests
    do: 'Integration tests for each executor'
    file: apps/local-bridge/src/release/tests/
  - id: red_team
    do: 'Profile capability denial test'
    file: apps/local-bridge/tests/red_team/release_plane.rs
  - id: web_test_update
    do: 'TargetCard test: assert enabled when implemented'
    file: apps/web/src/components/Release/TargetCard.test.tsx
  - id: validate
    do: 'cargo test, pnpm test, pnpm size'
acceptance:
  - 'release.deploy dispatches with ReadyToDeploy gate enforced'
  - 'release.publish dispatches with ReadyToPublish + two-party signoff'
  - 'Assessor profile call to release.deploy returns capability_denied'
  - 'release.deploy_progress events emit on real dispatch'
  - 'TargetCard buttons auto-enable after manifest flip (no UI change needed)'
  - 'Audit log persists deploy/publish/notes dispatch records'
  - 'Bundle size unchanged'
```

## Critical paths

- `config/capability-profiles/` — pattern executor.code untuk mirror.
- `apps/local-bridge/src/translator/mod.rs` — command dispatch table; tambah arm untuk `release.*`.
- `apps/local-bridge/src/handoff/` — pattern executor handler yang sudah landed (E1+E2); reuse `spawn_executor_for_handoff` pattern untuk `executor.release`.
- `apps/local-bridge/src/audit/` (atau `observability.rs:115` mention) — audit log append pattern.
- `mock-engine/src/scenarios/` — mock release scenario; flag `VAC_RELEASE_MODE` untuk fallback.

## Risks

1. **Connector OAuth blokir Phase 6 progress** — `release.publish` ke app store butuh GitHub/AppStore connector. Connector plane Phase 7. Mitigasi: implement `release.publish` v1 sebagai **dispatch ke local script + emit event**; integration cloud connector defer.
2. **Gate signoff backend not_wired** — sign-off + override commands juga `not_wired` (ditemukan di affordance closeout). Two-party signoff verification needs gate backend lebih dulu. Mitigasi: spinoff plan paralel `gate-governance-backend.md` (Phase 6 prerequisite); release plane gate enforcement v1 pakai static `gate.state` field saja, override audit deferred.
3. **Capability profile drift** — assessor swarm bisa accidentally inherit `executor.release` permissions kalau profile inheritance tidak strict. Mitigasi: red-team test mandatory pre-merge.
4. **Migration backward compat** — release state table schema change. Mitigasi: idempotent migration, zero-data fallback (empty table OK).
5. **Audit log size** — deploy events bisa banyak (per phase). Mitigasi: rotation policy reuse session persistence pattern.
6. **Mock-real divergence** — kalau mock engine diverged, event shape break frontend. Mitigasi: shared schema in `schema/observability-events.yaml` + codegen-check enforcement.

## Verification

### Backend
1. `cargo test -p local-bridge --features release` PASS.
2. `cargo test -p mock-engine` PASS (mock fallback intact).
3. Red-team: `cargo test --test red_team release_plane::*` — 100% capability denial assertions pass.

### Frontend
4. `pnpm -F web typecheck` PASS.
5. `pnpm -F web test` — TargetCard test asserts buttons enabled when manifest implemented.
6. `pnpm -F web size` — unchanged.

### Integration
7. Manual smoke (dev server + bridge):
   - Open Release panel, target dummy.
   - DevComplete + ReadyToDeploy + ReadyToPublish gates set to `pass` via dev console.
   - Click Deploy → bridge logs `release.deploy_dispatched`, event stream emits `deploy_progress: queued/deploying/deployed`.
   - Click Publish → bridge logs `release.publish_dispatched`.
   - Click Release notes → markdown render appears in NotesDraftView.
   - Audit log file `audit.jsonl` contains 3 dispatch entries.
8. Set assessor profile manually, attempt `release.deploy` → bridge returns `capability_denied`.

## UX impact

**Before**: Release panel functional but read-only (semua button disabled affordance-gate, copy "Release X backend is not wired yet.").
**After**: Buttons auto-enable, click triggers real dispatch, progress events stream into UI live. PRD §4.4 capability complete (minus Runbooks). Use case "Own gate to production" (PRD §2 DevOps persona) covered end-to-end.

## Rollback

- Manifest: revert 4 commands ke `not_wired`. Frontend auto-disables via affordance.
- Code: revert `apps/local-bridge/src/release/` directory + dispatch arm. Mock engine tidak terpengaruh.
- Audit log: append-only, no rollback needed.

## Timeline

Effort total: **3-5 hari** (24-40h spread, multi-PR):
- Day 1 (8h): capability profile + Rust module skeleton + persistence schema.
- Day 2 (8h): deploy executor + event producer + audit wiring.
- Day 3 (8h): publish executor + notes executor + gate enforcement.
- Day 4 (8h): tests (Rust + web update) + red-team + manual smoke.
- Day 5 (4h): manifest flip + codegen + closeout + plan review.

Dependency: F4 (date-locked sampai 2026-05-21) tidak block plan ini secara teknis (perf-only), tapi sebaiknya F4 settle dulu agar perf budget gate tidak interferensi dengan release deploy timing test.

## Sequencing relative to other plans

```
affordance-closeout (2-3h, P1) ──┐
                                 ├─→ release-plane-backend (3-5d, P1)
gate-governance-backend (TBD) ───┘                                 │
                                                                   ↓
                                                      release-runbooks (TBD, P2)
keyboard-nav-overlays (2-3h, P1) ── (independent)
F4 strict flip (date-locked 2026-05-21, P1) ── (independent perf gate)
```

## Critical files

- `config/capability-profiles/executor.release.yaml` (NEW)
- `config/control-plane/command-manifest.yaml` (4 entries flip)
- `apps/local-bridge/src/release/mod.rs` (NEW)
- `apps/local-bridge/src/release/handlers.rs` (NEW)
- `apps/local-bridge/src/release/deploy.rs` (NEW)
- `apps/local-bridge/src/release/publish.rs` (NEW)
- `apps/local-bridge/src/release/notes.rs` (NEW)
- `apps/local-bridge/src/translator/mod.rs` (dispatch arm)
- `apps/local-bridge/src/session/persistence/migrations/` (release_state schema)
- `apps/local-bridge/src/observability.rs` (audit append)
- `apps/local-bridge/src/command_catalog.rs` (regenerated)
- `apps/web/src/generated/commandCatalog.ts` (regenerated)
- `apps/web/src/components/Release/TargetCard.test.tsx` (assert enabled when implemented)
- `apps/local-bridge/tests/red_team/release_plane.rs` (NEW)
