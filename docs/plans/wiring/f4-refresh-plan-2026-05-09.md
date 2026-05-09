---
id: wiring.f4-refresh-plan-2026-05-09
title: 'F4 refresh plan'
priority: P1
area: closeout
status: draft  # 2026-05-09: date-locked until 2026-05-21; Phase H dry-run is informational only
owners:
  - web
  - tools
created: 2026-05-09
depends_on:
  - plans/f4-baseline-alarm-date-lock-2026-05-09 (deferred)
  - audits/f4-strict-dryrun-2026-05-09 (draft)
---

# F4 refresh plan (2026-05-09)

> **Status 2026-05-09:** draft. F4 remains date-locked until 2026-05-21. Phase H dry-run is informational only because `apps/web/tsconfig.base.json` already enables the relevant strict flags through the existing baseline. The blocker is persisted baseline history, not a web TypeScript cleanup.

## Workflow-as-code control plane

```yaml
slice: f4-refresh-plan-2026-05-09
priority: P1
area: closeout
owners:
  - web
  - tools
depends_on:
  - plans/f4-baseline-alarm-date-lock-2026-05-09 (deferred)
  - audits/f4-strict-dryrun-2026-05-09 (draft)
steps:
  - id: recheck
    do: 'On or after 2026-05-21, inspect .perf-baseline/history.jsonl and current perf budgets'
    status: pending
  - id: strict_flip
    do: 'Flip the perf budget gate from --measurement-only to --strict in .github/workflows/perf.yml'
    status: pending
  - id: validate
    do: 'Run Rust + web gates and confirm no regressions are masked by the stricter budget gate'
    status: pending
acceptance:
  - 'By 2026-05-19, .perf-baseline/history.jsonl contains at least 14 verified entries on main'
  - 'Perf workflow uses --strict only after the date lock expires'
  - 'Validation gates stay green after the flip'
```

## Current F4 state

- `docs/plans/f4-baseline-alarm-date-lock-2026-05-09.md` says no code should be added before 2026-05-21.
- `docs/plans/README.md` lists F4 as the only active handoff and says the perf workflow remains `--measurement-only` until the date lock expires.
- `docs/plans/wave-5-6-dependency-closeout-2026-05-09.md` documents F4 strict baseline alarm flip as intentionally deferred.
- `.perf-baseline/history.jsonl` is not committed to `main`; the perf workflow now persists it across runs via `actions/cache/restore@v4` + `actions/cache/save@v4` (added 2026-05-10), so the rolling baseline begins accumulating from the next scheduled perf run on Monday 04:00 UTC. Until at least one cron has fired, the history file only exists as a CI cache + uploaded artifact.
- `docs/perf-test-plan.md` still treats `--measurement-only` as the gate until F4 lands.
- Phase H dry-run was additive-only and did not probe any new strictness beyond the existing base config.

## Scope

### In scope

- Re-check `.perf-baseline/history.jsonl` on or after 2026-05-21.
- Flip the perf budget gate in `.github/workflows/perf.yml` from `--measurement-only` to `--strict` only if the stored history is old enough for the 14-day alarm.
- Re-run Rust, web, and perf gates after the workflow change.
- Update the plan index and adjacent docs to reflect the strict flip when it actually lands.

### Out of scope

- New perf drivers.
- Any `@types/node` upgrade.
- UI changes in `apps/web`.
- Changing runtime authority or performance measurement semantics outside the perf workflow.

## Deliverables

1. **Strict perf gate flip**
   - Acceptance: CI perf job uses `--strict` only after the date lock expires and the baseline is old enough.
2. **Baseline sanity check**
   - Acceptance: `.perf-baseline/history.jsonl` has at least 14 verified entries on main by 2026-05-19 and the strict gate is only enabled after the history window is valid.
3. **Validation pass**
   - Acceptance: Rust, web, and perf checks stay green after the workflow update.
4. **Plan/doc refresh**
   - Acceptance: docs in `docs/plans/` and related closeout notes reflect the strict flip and its effective date.

## Risks

1. **Baseline too young**
   - Mitigation: do not touch `.github/workflows/perf.yml` before 2026-05-21; re-check the history age first.
2. **Noisy false positives from perf variance**
   - Mitigation: keep the 14-day gate and verify the same 5 drivers continue to populate the baseline before flipping.
3. **Workflow YAML escaping regressions**
   - Mitigation: validate `perf.yml` integrity before and after the flip with the same GitHub Actions templating sanity check used for Phase A.
4. **Operator confusion about the zero-error dry-run**
   - Mitigation: keep the audit wording explicit that the dry-run is informational only, the base config is already strict, and the blocker is missing persisted baseline history.

## Rollback

- If the strict gate proves too noisy, revert the workflow change and return the perf budget gate to `--measurement-only`.
- Keep the baseline archive job intact so history keeps accumulating.
- Leave the date-lock doc in place if the window has not yet matured.

## Timeline

- **2026-05-09 to 2026-05-20:** no code changes; baseline history continues to accumulate.
- **2026-05-21:** re-check baseline age and perf history.
- **Same day, if criteria pass:** flip the perf workflow to `--strict`, rerun validation, and close the plan.

## UX impact

None before the flip. After the flip, only operator-facing perf alerts become stricter; there is no end-user surface change.
