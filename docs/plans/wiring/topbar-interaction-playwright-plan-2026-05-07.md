---
id: wiring.topbar-interaction-playwright-2026-05-07
title: 'Topbar interaction Playwright driver plan (F2.5)'
priority: P2
area: perf-tooling
status: closed  # landed 2026-05-09 via branch f2-5/topbar-interaction-playwright-driver-2026-05-09
owners:
  - tools
  - web
created: 2026-05-07
depends_on:
  - wiring/post-r1-r6-followups-plan-2026-05-07 (active, F2)
  - wiring/cockpit-ux-implementation-plan-2026-05-07 (closed, F5c-web PerfBadge)
---

# Topbar interaction Playwright driver plan (F2.5)

**Status**: closed (2026-05-09)
**Created**: 2026-05-07
**Estimated**: 6–10h focused single session
**Predecessor**: `docs/plans/wiring/post-r1-r6-followups-plan-2026-05-07.md` (F2)
**Budget**: `topbar_interaction_p95_ms = 100` (`config/slo-budgets.yaml`)

> **Closeout 2026-05-09**: All four slices landed. Implementation diverges from the original plan in two minor ways, both better-aligned with the actual codebase:
>
> 1. **Settings overlay testid**: plan §4.1 step 4 referenced `[data-testid="settings-panel"]`; the actual testid in `apps/web/src/components/Settings/SettingsPage.tsx:39` is `settings-overlay`. Spec uses the actual testid.
> 2. **Spec output shape**: plan §4.1 step 6 specified the spec emits `{subsystem, p95_ms, samples_n}` (pre-aggregated). Spec instead emits `{subsystem, samples_ms}` (raw per-iteration ms array) so the Rust driver can convert ms→ns and reuse the shared `summarize()` helper that the other four drivers already use; percentile computation stays in one place. Rust driver also uses the actual `pub fn measure() -> anyhow::Result<Measurement>` shape (matching the other drivers) rather than the plan §4.2 `pub fn run(samples: usize) -> anyhow::Result<crate::PerfSample>` signature, which referred to a type that does not exist in the codebase.
>
> Files landed: `apps/web/tests/perf/topbar_interaction.spec.ts` (new), `tools/perf/src/scenarios/topbar_interaction.rs` (replaces bail), `tools/perf/src/scenarios/mod.rs` (dispatch arm), `apps/web/playwright.config.ts` (perf project), `apps/web/package.json` (`e2e` scoped to chromium project, `perf:driver` script added), `.github/workflows/perf.yml` (Chromium cache + install + `--features real_scenarios`), `docs/perf-test-plan.md` (Phase 2 marked landed). F2 marked closed in [`post-r1-r6-followups-plan-2026-05-07.md`](./post-r1-r6-followups-plan-2026-05-07.md); only F4 (date-locked until 2026-05-21) remains in the post-r1-r6 plan.

---

## 1. Why this plan exists

Last remaining real perf driver from Phase 2. Four other drivers (`command_ack`, `websocket_event_delivery`, `persisted_event_write`, `command_manifest_refresh`) shipped real in commits `dc6c846`…`a631298` with p95 well under budget. Only `topbar_interaction` still bails with `not implemented (Phase 2)` at `tools/perf/src/scenarios/topbar_interaction.rs:17`.

This driver was deliberately split out of the F2 slice because the Playwright headless harness adds non-trivial setup cost (browser install, dev-server boot, child-process bridge to Rust) that does not fit the in-process pattern of the other four.

Quoting `post-r1-r6-followups-plan-2026-05-07.md` lines 119–122:

> `topbar_interaction` | requires Playwright/headless harness; measure click → state-change in cockpit; consider scoping to a separate UI perf plan
>
> Per-driver effort: 4–8 hours (excluding `topbar_interaction` which adds Playwright setup cost — separate ~6–10h).

---

## 2. Scope

### In-scope

- Replace bail in `tools/perf/src/scenarios/topbar_interaction.rs` with a real driver that spawns a Playwright spec and parses its JSON output.
- New Playwright spec at `apps/web/tests/perf/topbar_interaction.spec.ts` (separate folder from existing `tests/e2e/` to keep concerns isolated).
- One target interaction only: `data-testid="topbar-settings-button"` (most stable surface; alternatives `model-context-chip`, `perf-badge` rejected as scope creep).
- Sample count: 50 clicks, p95 reported.
- CI integration in `.github/workflows/perf.yml`: install Chromium, run real scenarios job including new driver.
- Update `docs/perf-test-plan.md` with F2.5 section.
- Mark F2 closed in `post-r1-r6-followups-plan-2026-05-07.md` once landed.

### Non-scope

- Multi-target perf (settings + model picker + cmdK in one run).
- Visual regression testing.
- Cross-browser perf (Chromium-only).
- Mobile cockpit perf.
- Web Vitals (LCP / CLS / INP) integration.
- Refactor of `PerfBadge` or `Topbar.tsx` internals.
- Replacement of existing e2e tests in `apps/web/tests/e2e/`.
- Per-driver baseline alarm tuning (covered by F4 strict-flip).

---

## 3. Pre-flight checklist for new session

- [x] HEAD `590adae` or later, working tree clean.
- [x] `pnpm -F web exec playwright install --with-deps chromium` run on host once.
- [x] `pnpm -F web exec playwright --version` >= 1.40.
- [x] `tools/perf/src/scenarios/topbar_interaction.rs:17` still bails with `not implemented (Phase 2)`.
- [x] `cargo run -p perf --features real_scenarios -- --duration 5 --output /tmp/baseline.json` succeeds for the four shipped drivers.
- [x] User confirms target interaction is `topbar-settings-button` (default) before coding.
- [x] User confirms 50 samples is acceptable; if not, agree on N before slice 4.1.
- [x] `config/slo-budgets.yaml` `topbar_interaction_p95_ms` field present (= 100).

---

## 4. Slice breakdown

### Slice 4.1 — Playwright perf harness (web side, 2–3h)

**New file**: `apps/web/tests/perf/topbar_interaction.spec.ts`

Responsibilities:

1. Boot Vite dev server via Playwright `webServer` config (reuse if already running).
2. Navigate to cockpit shell with mock transport fixture.
3. Wait for `[data-testid="topbar-settings-button"]` to be present and enabled.
4. Loop 50 iterations:
   - Capture `t0 = performance.now()` in browser context.
   - Click button.
   - Wait for `[data-testid="settings-panel"]` to become visible.
   - Capture `t1 = performance.now()`.
   - Push `t1 - t0` to samples array.
   - Click `[data-testid="settings-close"]` to reset state.
5. Sort samples ascending; compute `p95 = samples[floor(0.95 * length)]`.
6. Emit single JSON line to stdout:
   ```json
   {"subsystem":"topbar_interaction","p95_ms":<float>,"samples_n":50,"started_at":"<iso>","finished_at":"<iso>"}
   ```

**Reporter**: use `--reporter=line` to keep stdout clean for the JSON line. Driver Rust will pick the last line that parses as JSON.

**playwright.config.ts**: add a separate project `perf` so it does not collide with existing `e2e` project.

**Deliverable**: `pnpm -F web exec playwright test --project=perf` runs the spec, exits 0, prints JSON line on stdout.

---

### Slice 4.2 — Rust driver wiring (Rust side, 2–3h)

**File**: `tools/perf/src/scenarios/topbar_interaction.rs`

Replace bail with:

```rust
use std::process::Command;
use std::time::Instant;

pub fn run(samples: usize) -> anyhow::Result<crate::PerfSample> {
    let started = chrono::Utc::now();
    let timer = Instant::now();
    let output = Command::new("pnpm")
        .args([
            "-F", "web",
            "exec", "playwright", "test",
            "tests/perf/topbar_interaction.spec.ts",
            "--project=perf",
            "--reporter=line",
        ])
        .current_dir("../..")
        .output()?;
    if !output.status.success() {
        anyhow::bail!(
            "playwright exit {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let stdout = String::from_utf8(output.stdout)?;
    let json_line = stdout
        .lines()
        .filter(|l| l.trim_start().starts_with('{'))
        .last()
        .ok_or_else(|| anyhow::anyhow!("no JSON line from playwright"))?;
    let sample: crate::PerfSample = serde_json::from_str(json_line)?;
    let _elapsed = timer.elapsed();
    let _finished = chrono::Utc::now();
    Ok(sample)
}
```

**Cargo.toml**: no new deps; `chrono` already in `real_scenarios` feature, `std::process::Command` is core.

**Deliverable**: `cargo run -p perf --features real_scenarios -- --duration 60 --output /tmp/perf-real.json` returns JSON with 5 entries including `topbar_interaction`, p95 < 100ms.

---

### Slice 4.3 — CI integration (1–2h)

**File**: `.github/workflows/perf.yml`

In the `real-scenarios` job (the one already running `cargo run -p perf --features real_scenarios`):

1. Add Playwright browser cache:
   ```yaml
   - name: Cache Playwright browsers
     uses: actions/cache@v4
     with:
       path: ~/.cache/ms-playwright
       key: playwright-$ runner.os -$ hashFiles('apps/web/pnpm-lock.yaml') 
   ```
2. Install browsers (only chromium):
   ```yaml
   - name: Install Playwright Chromium
     run: pnpm -F web exec playwright install --with-deps chromium
   ```
3. Confirm existing cargo step now includes `topbar_interaction` p95 in output JSON.

**Deliverable**: CI green; `.perf-baseline/history.jsonl` accumulates entries with all 5 drivers populated.

---

### Slice 4.4 — Docs update (~30 min)

- Update `docs/perf-test-plan.md` with new F2.5 section (sample size, target testid, harness diagram).
- Mark `post-r1-r6-followups-plan-2026-05-07.md` F2 row `topbar_interaction` as shipped; flip plan-level F2 status to closed.
- Add commit reference in this plan's frontmatter `status` field on landing.

---

## 5. Acceptance criteria

- [x] `cargo run -p perf --features real_scenarios -- --duration 60 --output /tmp/perf-real.json` returns exactly 5 entries, each `p95_ms` < its budget in `config/slo-budgets.yaml`.
- [x] `topbar_interaction` p95 < 100ms locally and in CI (3 consecutive CI runs).
- [x] `cargo fmt --all -- --check` clean.
- [x] `cargo clippy --workspace --all-targets -- -D warnings` clean.
- [x] `cargo test --workspace` clean.
- [x] `pnpm -F web typecheck && pnpm -F web test && pnpm -F web build` clean (web 99 file / 687 test baseline preserved or improved).
- [x] All 4 codegen drift checks pass.
- [x] `apps/web/tests/perf/topbar_interaction.spec.ts` runs in `--project=perf`, does NOT run under default `pnpm -F web test` (vitest) or default `playwright test` (e2e project).
- [x] No new `\u2026` / `\u2014` JSX text introduced (hard rule).
- [x] No `&&` short-circuits in any new shell snippet (hard rule).

---

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Flaky timing in CI runners | False alarms in baseline watch | 50 samples + p95 (not max), tolerate +-10% in F4 strict mode |
| Dev-server cold boot adds noise | First sample inflated | Warm-up: discard first 5 samples before measurement window |
| Browser install size (~200MB) in CI | Slower CI | actions/cache keyed on lockfile hash |
| Concurrency with existing e2e | Test cross-talk | Separate Playwright project `perf`, run sequentially |
| `pnpm` not on PATH in CI worker | Driver bails | Use `corepack enable` step before driver call (already standard in workflow) |
| Headless vs headed timing skew | Local-vs-CI numbers diverge | Always headless in driver; document in perf-test-plan |

---

## 7. Sequencing relative to F4

F2.5 should land before F4 (`--measurement-only` -> `--strict` flip) so `topbar_interaction` participates in the baseline alarm from the first strict run.

F4 is date-locked at earliest 2026-05-21. Recommended F2.5 land window: 2026-05-08 .. 2026-05-15, leaving >= 6 days of CI history to accumulate >= 6 entries with 5/5 drivers populated.

---

## 8. Out-of-scope future work (not committed)

- Per-component perf budgets (not just whole-topbar latency).
- PR-comment annotation when p95 regresses (extension of F4 strict mode).
- Web Vitals (LCP / CLS / INP) integration as separate driver group.
- Multi-step interactions (settings -> change -> save) as compound scenarios.
- Network-throttled variants (fast-3G / slow-3G) for perf characterization.

---

## 9. References

- `tools/perf/src/scenarios/topbar_interaction.rs` (current bail stub).
- `tools/perf/src/scenarios/mod.rs` (dispatch table).
- `tools/perf/src/main.rs:103` (`subsystem: "topbar_interaction"` registration).
- `apps/web/playwright.config.ts` (existing Playwright config).
- `apps/web/tests/e2e/` (existing e2e suite, NOT to be touched by this plan).
- `apps/web/src/components/cockpit/Topbar.tsx:335` (`onClick={onSettings} data-testid="topbar-settings-button"`).
- `apps/web/src/components/cockpit/PerfBadge.tsx` (consumer of perf store, F5c-web).
- `config/slo-budgets.yaml` (`topbar_interaction_p95_ms = 100`).
- `.github/workflows/perf.yml` (target CI workflow).
- `docs/plans/wiring/post-r1-r6-followups-plan-2026-05-07.md` (F2 parent slice).
