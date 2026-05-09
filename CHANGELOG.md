# Changelog

All notable changes to vac-web are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Post-v1 cockpit UX wiring (F5a/F5b/F5c)** — Release plane UI (`ReleasePanel`, `TargetCard`, `DeployProgressList`, `NotesDraftView`, `ObservationsFeed`); Settings/Extensions tab (`ExtensionsList`, `TrustActionMenu`, `QuarantineConfirmModal`, `PromotionRequestModal`, `PendingApprovals`); Topbar `PerfBadge` (in `cockpit/`).
- **Trust real classification (F1)** — three production callsites of `enforce_extension_trust` in `apps/local-bridge/src/extensions/handlers.rs`; `config/extension-trust.yaml` as runtime SSOT.
- **Perf baseline watch (F3)** — `scripts/perf-baseline-archive.mjs` + `scripts/perf-baseline-compare.mjs`; `.perf-baseline/` history surface; CI wires archive + compare + upload.
- **Real per-subsystem perf drivers (F2 — 4/5)** — `command_ack`, `websocket_event_delivery`, `persisted_event_write`, `command_manifest_refresh`. F2.5 `topbar_interaction` split to dedicated Playwright plan.
- **ADR-0004 (F6)** — extension trust mutation controls.
- **Two trust hardening rounds** — audit-hardened `extensions.update_trust`; TOCTOU-safe writer (`fs2::FileExt::lock_exclusive` + tempfile atomic rename); session-bound admin gate via `profile_layer::enforce_action`; structured `audit::log_structured()` with namespace allowlist; two-party promotion approval (`request_promotion` / `approve_promotion` / `list_approvals`, proposer ≠ approver); live perf telemetry (`perf.latest_run` / `perf.run_completed`).
- **Wave 5-6 dependency closeout (PR #23–#30)** — Vite 8, React 19, `@vitejs/plugin-react` 6, Vitest 4, scoped `@xterm/*` 6, Tailwind 4, ESLint 10, size-limit 12, `@noble/*` v2; closeout doc `docs/plans/wave-5-6-dependency-closeout-2026-05-09.md`.
- **Topbar interaction Playwright e2e coverage (PR #22)**.
- Post-audit v1 hardening pass (see §v1.0.0).

### Deferred

- **F4 CI strict flip** — perf workflow stays on `--measurement-only`; date-locked until 2026-05-21 (see `docs/plans/f4-baseline-alarm-date-lock-2026-05-09.md`).
- **F2.5 `topbar_interaction` real Playwright driver** — last remaining real perf driver (see `docs/plans/wiring/topbar-interaction-playwright-plan-2026-05-07.md`).
- **`@types/node` 22 → 25 (dev)** — runtime target still Node 20/22; widening dev types ahead would mask incompatibilities (see `docs/plans/wave-5-6-dependency-closeout-2026-05-09.md`).

## [1.0.0] — 2026-04-24

First tagged release. Phases 0–8 complete.

### Added

- **Phase 0.1–0.6** — foundations: 14 contract docs, JSON Schemas v1,
  codegen (TS + Rust), profile-core, bridge-core, mock-engine, red-team
  harness.
- **Phase 1.1–1.7** — bridge + web MVP: axum WebSocket + session manager
  + JSON-RPC translator + profile enforcement + JWT auth + audit + pairing.
- **Phase 2.1–2.6** — cockpit core: markdown-it + DOMPurify sanitize,
  Shiki syntax highlight worker, command palette, UX grammar (severity
  glyphs + notify lanes + activity rail), overlay manager.
- **Phase 3.1–3.7** — execution surfaces: Workbench tabs (Approvals,
  Review+DiffViewer, Sessions, Runtime, Shell drawer with lazy xterm,
  Connectors, Mention search).
- **Phase 4.1–4.8** — assessment MVP: RTD + PM swarms, Readiness Hub,
  virtualized findings, Gate system + GateRibbon + gate_detail overlay,
  freshness tiers (fresh/aging/stale/hard_expire).
- **Phase 5.1–5.6** — handoff + reassess loop: packet lifecycle, two-party
  signoff (self-sign rejected), pin mock, AssessmentDiff 4-tab view,
  convergence guard.
- **Phase 6.1–6.8** — remaining 10 assessor families (UX, Frontend,
  Security, Reliability, Performance, QA, Docs, Launch, Release, Growth),
  4 new gates (QAComplete, ReadyForStaging, ReadyToPublish,
  ReadyForGrowth), Release plane (Deploy / Publish / Runbooks / Release
  Notes / Post-release Monitor), Archive tab (Plan / VIL / Signal / Memory
  lenses + `.vacz.json` export), 14 connectors.
- **Phase 7.1–7.7** — hosted dispatch: new `relay-service` crate (blind
  router), bridge `tunnel` mode, web relay transport, QR pairing,
  device revocation, E2E keypair scaffold.
- **Phase 8.1–8.6** — continuous readiness: trigger routing table,
  debounce, input-surface invalidation, regression detector wired to
  `assessment.completed`, Guided mode wizard, Migration tab with strict
  trust model (two-party invariant, reversibility proof, maintenance
  window).

### Security

- Profile enforcement Layer 1 denies all mutation-class commands at the
  bridge boundary before they reach the engine.
- Pairing codes use OS CSPRNG; rate-limited to 16 active codes per 60s.
- `AuthState` requires ≥ 32-byte secret; `allow_anonymous` is dev-only
  and audit-logged on use.
- Relay `TeleportToken` is short-lived (5 min TTL), single-use by nonce,
  bound to `{device_id, session_id}` — cross-device smuggling rejected
  with `token_binding_mismatch`.
- Regression detector fires `sticky` notify on verdict drop / score drop
  ≥ 0.15 / finding-returned signals.

### Known limitations

Documented deferrals (see `SECURITY.md §Known limitations`):

- **E2E keypair mode** (Phase 7.6) is a canary stub; production
  XChaCha20-Poly1305 lands in 7.6.1. Plain mode is default and secure
  under the "trust your relay operator" model.
- **Bridge tunnel routing** (Phase 7.3) is an echo scaffold until
  session-manager integration lands.
- **Migration dispatch** (Phase 8.5) is UI-only; bridge commands stub
  until upstream VAC ships `executor.migration@1.0.0`.
- **Red-team coverage** is 15 baseline cases; target is 175. The delta is
  tracked via `docs/red-team-test-plan.md` and will land incrementally
  post-GA; the existing suite covers all Layer-1 enforcement paths.
- **`executor.migration@1.0.0` profile YAML** ships as a manifest entry
  in v1.0.0; the full policy catalog lands with the upstream PR.

### Upstream dependencies (intentional holds)

These upstream VAC PRs back the phase features above; the UI + bridge-edge
surfaces shipped here slot in without breaking changes when they merge.

- PR #6 `evidence.capture` tool
- PR #7 `finding.emit` + AssessmentRun lifecycle
- PR #8 `worktree_digest` util + `executor.code@1.0.0` profile
- PR #9 scope-bundle + `executor.release@1.0.0` profile
- PR #10 `TeleportToken` mint/verify public API
- PR #11 `executor.migration@1.0.0` profile (Phase 8.5)

[Unreleased]: https://github.com/IbrohimMid/vac-web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/IbrohimMid/vac-web/releases/tag/v1.0.0
