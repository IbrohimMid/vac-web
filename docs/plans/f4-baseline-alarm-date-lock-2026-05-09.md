---
id: plans.f4-baseline-alarm-date-lock-2026-05-09
title: 'F4 baseline alarm date-lock'
priority: P1
area: perf-tooling
status: deferred  # active handoff; date-locked until 2026-05-21
owners:
  - tools
  - web
created: 2026-05-09
---

# F4 baseline alarm date-lock audit — 2026-05-09

Status: skipped intentionally.

Reason: the F4 baseline alarm is date-locked until 2026-05-21. No code should be added before that date because it would create premature alerting noise and risk training users to ignore the baseline badge.

UX impact: deferring keeps performance alerts meaningful. Users only see the current perf badge state until enough baseline age exists for a reliable 14-day alarm.

Next action on or after 2026-05-21:
- Re-check available baseline history.
- Implement the 14-day alarm only if the stored baseline is old enough.
- Validate with unit tests and size-limit so the topbar remains lightweight.
