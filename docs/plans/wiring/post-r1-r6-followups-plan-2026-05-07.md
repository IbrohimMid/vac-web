---
id: wiring.post-r1-r6-followups-2026-05-07
title: 'Post R1–R6 follow-ups execution plan'
priority: P1
area: closeout
status: active  # F1, F3 closed in this plan; F2, F4, F5, F6 planned/deferred
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
    status: planned
  - id: F3
    do: 'Baseline watch infrastructure'
    status: closed
  - id: F4
    do: 'Flip CI default --measurement-only → --strict after 14d baseline'
    status: deferred
  - id: F5
    do: 'Phase 3 trust cockpit UX'
    status: planned
  - id: F6
    do: 'ADR refresh cycle'
    status: planned
acceptance:
  - 'F1, F3 closed in commit landing this plan'
  - 'F2 has driver-level acceptance'
  - 'F4 deferred until 2026-05-21 (14d from baseline start)'
  - 'F5, F6 scoped with effort estimate'
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

### F2 — Phase 2 perf: 5 real per-subsystem drivers (planned)

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

### F5 — Phase 3 trust cockpit UX (planned)

**Scope**:

- Cockpit settings page: list extensions with trust tier badges
- Revoke action: confirmation modal + bridge endpoint to write `tier: revoked` to YAML
- Quarantine flow: warning banner when loading quarantined extension; sandbox capabilities
- Backend: bridge endpoint `extensions.update_trust` invoking `enforce_extension_trust` + persisting YAML

**Effort**: 6–10 hours (UI + backend + tests).

**Depends on**: F1 (✅) for runtime classification.

### F6 — ADR refresh cycle (planned)

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
