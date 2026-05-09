---
id: wiring.post-r1-r6-followups-2026-05-07
title: 'Post R1–R6 follow-ups execution plan'
priority: P1
area: closeout
status: closed_partial  # 2026-05-09: F1/F2/F3 closed in this plan family; F5/F6 closed via cockpit-UX plan + ADR-0004; F2.5 topbar Playwright driver landed; F4 deferred until 2026-05-21
owners:
  - bridge
  - web
  - tools
created: 2026-05-07
depends_on:
  - wiring/remaining-work-execution-plan-2026-05-06 (closed)
  - wiring/executor-implementation-plan (landed)
---

# Post R1–R6 follow-ups execution plan (2026-05-07)

> **Update 2026-05-09 (closeout sweep + F2.5 close)**: F5 and F6 closed; F2 also closed — 5/5 drivers landed, with F2.5 `topbar_interaction` Playwright driver landed via [`topbar-interaction-playwright-plan-2026-05-07.md`](./topbar-interaction-playwright-plan-2026-05-07.md). F4 still date-locked until 2026-05-21 (per [`../f4-baseline-alarm-date-lock-2026-05-09.md`](../f4-baseline-alarm-date-lock-2026-05-09.md)). Plan status remains `closed_partial` — only F4 deferred; everything else closed. Two trust hardening rounds (audit-hardened `update_trust`, TOCTOU fix, session-bound admin gate, two-party promotion approval, live perf telemetry) layered on top of F5 — see README §Recent highlights and ADR-0004.

Follow-up work after closing `remaining-work-execution-plan-2026-05-06.md` (R1–R6) and landing Phase 2 scaffolding for perf and trust. Items split into closed-in-this-plan (F1, F3) and planned/deferred (F2, F4, F5, F6).

## Workflow-as-code control plane

```yaml
slice: post-r1-r6-followups-2026-05-07
priority: P1
area: closeout
owners:
  - bridge
  - web
  - tools
depends_on:
  - wiring/remaining-work-execution-plan-2026-05-06 (closed)
  - wiring/executor-implementation-plan (landed)
sources:
  - tools/perf
  - packages/profile-core
  - config/extension-trust.yaml
  - .github/workflows/perf.yml
  - .perf-baseline/
steps:
  - id: F1
    do: 'Phase 2 trust real classification — read YAML, classify against allowlist'
    status: closed
  - id: F2
    do: 'Phase 2 perf real per-subsystem drivers (5)'
    status: closed  # 5/5 landed (command_ack, websocket_event_delivery, persisted_event_write, command_manifest_refresh, topbar_interaction); F2.5 Playwright driver landed 2026-05-09
  - id: F3
    do: 'Baseline watch infrastructure'
    status: closed
  - id: F4
    do: 'Flip CI default --measurement-only → --strict after 14d baseline'
    status: deferred
  - id: F5
    do: 'Phase 3 trust cockpit UX'
    status: closed  # closed 2026-05-09 via cockpit-ux-implementation-plan-2026-05-07.md (F5a/F5b/F5c) plus two trust hardening rounds
  - id: F6
    do: 'ADR refresh cycle'
    status: closed  # closed 2026-05-09 — ADR-0004 (extension trust mutation controls) added; ADR-0003 cross-linked
acceptance:
  - 'F1, F3 closed in commit landing this plan'
  - 'F2 has driver-level acceptance — 5/5 landed; F2.5 (topbar_interaction) Playwright driver closed 2026-05-09'
  - 'F4 deferred until 2026-05-21 (14d from baseline start)'
  - 'F5 closed 2026-05-09 (cockpit-UX plan landed; trust hardening rounds 1+2 layered on top)'
  - 'F6 closed 2026-05-09 (ADR-0004 added; ADR-0003 cross-linked)'
validation_gates:
  - cargo test -p profile-core
  - node scripts/check-extension-trust.mjs
  - cargo run -p perf -- --duration 1 --output /tmp/perf-smoke.json
  - node scripts/perf-baseline-archive.mjs /tmp/perf-smoke.json --history /tmp/baseline.jsonl
  - node scripts/perf-baseline-compare.mjs /tmp/perf-smoke.json --history /tmp/baseline.jsonl --window 14
```

## Items

### F1 — Phase 2 trust real classification ✅ closed (2026-05-07)

**Implementation**: `packages/profile-core/src/extension_trust.rs`

- `ExtensionTrustConfig` + `ExtensionEntry` + `ExtensionTier` + `ExtensionSource` serde types deserialize from `config/extension-trust.yaml`.
- `ExtensionTrustConfig::load(path)` reads + validates schema version.
- `enforce_extension_trust(ctx, config) -> TrustDecision` — pure classification function.

**Algorithm** (deny-by-default):

1. Look up extension in `config.extensions` by id.
2. If found:
	- `tier=revoked` → `Revoked`
	- `tier=quarantined` → `Quarantined`
	- `tier=allowed_bundled` + `source=bundled` → `AllowedBundled`
	- `tier=allowed_signed` + `source=signed` + matching publisher in allowlist + non-empty signature → `AllowedSigned`
	- any other combination → `Quarantined` (safe default)
3. If not found:
	- `allow_unsigned: true` → `AllowedBundled`
	- `allow_unsigned: false` → `Quarantined`

**Tests** (10 unit tests, all pass):

- empty config denies unknown
- `allow_unsigned=true` grants bundled to unknown
- bundled entry returns `AllowedBundled`
- signed entry with matching pubkey + sig returns `AllowedSigned`
- signed entry without signature → `Quarantined`
- signed entry with unauthorized publisher → `Quarantined`
- signed entry with publisher not in allowlist → `Quarantined`
- revoked entry → `Revoked`
- quarantined entry → `Quarantined`
- yaml load round-trip + version mismatch rejection

**Phase 1 → Phase 2 migration**: function signature changed from `fn(ctx)` to `fn(ctx, config)`. No production callers existed; Phase 1 stub was unused. Cockpit/bridge integration deferred to F5.

### F2 — Phase 2 perf: 5 real per-subsystem drivers ✅ closed (2026-05-09)

**Update 2026-05-09**: All 5 drivers shipped real (`command_ack`, `websocket_event_delivery`, `persisted_event_write`, `command_manifest_refresh`, `topbar_interaction`). F2.5 `topbar_interaction` Playwright driver landed via [`topbar-interaction-playwright-plan-2026-05-07.md`](./topbar-interaction-playwright-plan-2026-05-07.md); the bail at `tools/perf/src/scenarios/topbar_interaction.rs:17` is replaced by a Playwright-driven harness that spawns the dedicated `perf` project, parses `{subsystem, samples_ms}` from `VAC_PERF_OUTPUT`, converts ms→ns, and reuses the shared `summarize()` reducer. Perf workflow now runs `cargo run -p perf --release --features real_scenarios` so all 5 drivers populate the rolling baseline at `.perf-baseline/history.jsonl`.

**Goal**: replace synthetic constants in `tools/perf/src/main.rs` with real measurements from running local-bridge instances.

| Driver | Acceptance |
| --- | --- |
| `command_ack` | spawn local-bridge in-process via `local_bridge::server::build_app` + `SessionRegistry`; open WS client; send N=1000 echo commands; record per-command ack latency |
| `websocket_event_delivery` | open WS client; trigger N events server-side via translator API; measure publish→frame timing |
| `persisted_event_write` | configure `FilePersistence` with tempdir; emit N events; measure to fsync ack |
| `topbar_interaction` | requires Playwright/headless harness; measure click→state-change in cockpit; consider scoping to a separate UI perf plan |
| `command_manifest_refresh` | bump manifest version; trigger refresh from N clients; measure refresh→applied state |

**Per-driver effort**: 4–8 hours (excluding `topbar_interaction` which adds Playwright setup cost — separate ~6–10h).

**Wiring**: each driver under `tools/perf/src/scenarios/<name>.rs`, gated by `#[cfg(feature = "real_scenarios")]`. Replace `Measurement` placeholder values in `main.rs` when feature enabled.

**Source references** (already inspected 2026-05-07):
- `apps/local-bridge/src/lib.rs` exposes `server`, `session`, `handoff`, `agent_runtime`, etc.
- Test pattern in `apps/local-bridge/tests/handoff_dispatch.rs` shows how to spawn `SessionRegistry` + `HandoffService` from external crates.
- `tools/perf` would need new dep on `local-bridge` (path).

### F3 — Baseline watch infrastructure ✅ closed (2026-05-07)

**Implementation**:

- `scripts/perf-baseline-archive.mjs` — appends `perf-results.json` to `.perf-baseline/history.jsonl`
- `scripts/perf-baseline-compare.mjs` — compares current run vs rolling N-day p95-of-p95; flags `>threshold` regressions (default 25%)
- `.perf-baseline/README.md` — usage documentation

**Smoke test acceptance**:

```bash
cargo run -p perf -- --duration 1 --output /tmp/perf-smoke.json
node scripts/perf-baseline-archive.mjs /tmp/perf-smoke.json --history /tmp/baseline.jsonl  # 1 entry
node scripts/perf-baseline-archive.mjs /tmp/perf-smoke.json --history /tmp/baseline.jsonl  # 2 entries
node scripts/perf-baseline-compare.mjs /tmp/perf-smoke.json --history /tmp/baseline.jsonl --window 14
# Output: comparing current run vs 2 entries in last 14d, all OK
```

**CI wiring (deferred, separate F3-CI step)**: requires actions/cache restore + save pattern to persist `history.jsonl` across cron runs. Implementation template:

1. Add cache restore step before perf harness with key `perf-baseline-history`
2. After existing measurement-only check, run `node scripts/perf-baseline-archive.mjs perf-results.json`
3. Run `node scripts/perf-baseline-compare.mjs perf-results.json --window 14` (continue-on-error initially)
4. Add cache save step at end with date-suffixed key
5. Optionally upload `.perf-baseline/` as artifact with 90d retention

Skipped in F3 scripts-landing because perf.yml YAML edits with GitHub Actions templating need careful escaping; tracked here for next operator pass. Effort: ~30 minutes.

### F4 — Flip CI default `--measurement-only` → `--strict` (deferred)

**Trigger**: 14 calendar days after baseline watch starts emitting in CI (i.e., from first archive run after F3 CI wiring lands).

**Acceptance**:

- 14-day rolling p95 stable within budget for all 5 subsystems
- No `REGRESS` flags in `perf-baseline-compare.mjs` output for 4 consecutive cron runs
- Update `.github/workflows/perf.yml`: replace `--measurement-only` with `--strict` in the check step

**Earliest target**: 2026-05-21 (assuming baseline start 2026-05-07 + 14 days).

### F5 — Phase 3 trust cockpit UX ✅ closed (2026-05-09)

**Closed via**: [`cockpit-ux-implementation-plan-2026-05-07.md`](./cockpit-ux-implementation-plan-2026-05-07.md) (F5a Release panel + F5b Extensions settings + bridge wiring + F5c Perf badge + CI baseline wiring) plus two trust hardening rounds layered on top (audit-hardened `update_trust`, TOCTOU fix, session-bound admin gate via `profile_layer::enforce_action`, structured audit emission, two-party promotion approval flow, live perf telemetry). Three production callsites of `enforce_extension_trust` now exist in `apps/local-bridge/src/extensions/handlers.rs` (lines 340, 464, 934).

**Scope**:

- Cockpit settings page: list extensions with trust tier badges
- Revoke action: confirmation modal + bridge endpoint to write `tier: revoked` to YAML
- Quarantine flow: warning banner when loading quarantined extension; sandbox capabilities
- Backend: bridge endpoint `extensions.update_trust` invoking `enforce_extension_trust` + persisting YAML

**Effort**: 6–10 hours (UI + backend + tests).

**Depends on**: F1 (✅) for runtime classification.

### F6 — ADR refresh cycle ✅ closed (2026-05-09)

**Closed via**: ADR-0004 (`docs/adr/0004-extension-trust-mutation-controls.md`) capturing the trust-mutation guardrails introduced in trust hardening rounds 1+2. ADR-0003 (`docs/adr/0003-extension-trust-model.md`) cross-linked from protocol §3.17 / §4.14 and red-team §3.13.

**Scope**:

- Audit `docs/adr/` for outdated references (post Pass #28 + R1–R6 closeout + F1/F3)
- Identify ADRs whose decisions changed but not documented
- Either close (with closing rationale) or supersede with new ADR

**Effort**: 2–4 hours.

## Acceptance criteria

- ✅ F1 closed: real classification + 10 unit tests
- ✅ F3 closed: archive + compare scripts + .perf-baseline/ directory
- F2, F4, F5, F6 documented with concrete acceptance and effort estimate
- Plan registered in `docs/plans/README.md` under Active handoffs
