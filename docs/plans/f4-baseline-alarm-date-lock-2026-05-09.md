---
id: plans.f4-baseline-alarm-date-lock-2026-05-09
title: 'F4 baseline alarm date-lock'
priority: P1
area: perf-tooling
status: closed  # 2026-05-10: superseded by warmup-safe strict flip
owners:
  - tools
  - web
created: 2026-05-09
---

# F4 baseline alarm date-lock audit — 2026-05-09

> **Closeout 2026-05-10:** date-lock superseded by warmup-safe strict gate (`MIN_STRICT_WINDOW = 5` in `scripts/perf-baseline-compare.mjs`). The mitigation behind this lock — preventing premature alerting noise from undersized baseline windows — is now enforced in code rather than calendar. See `docs/plans/wiring/f4-refresh-plan-2026-05-09.md` closeout note. Original lock rationale retained below for archaeology.

Status: skipped intentionally.

Reason: the F4 baseline alarm is date-locked until 2026-05-21. No code should be added before that date because it would create premature alerting noise and risk training users to ignore the baseline badge.

UX impact: deferring keeps performance alerts meaningful. Users only see the current perf badge state until enough baseline age exists for a reliable 14-day alarm.

Next action on or after 2026-05-21:
- Re-check available baseline history.
- Implement the 14-day alarm only if the stored baseline is old enough.
- Validate with unit tests and size-limit so the topbar remains lightweight.
