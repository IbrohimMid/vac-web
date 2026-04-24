# Plan 39 — Continuous readiness + migration profile

**Phase**: 8 · **Depends on**: Plans 26, 30, 36, 37 · **Blocks**: — (ongoing) · **Est**: ongoing, ~4 weeks initial

## Goal

Orchestrator becomes proactive: background watchdog maintains live readiness scores across all families, stage-based triggers fire on meaningful events (PR merge, CI green, protected-ref push), guided mode walks non-technical users through a project's relevant subset. Also: ship `executor.migration@1.0.0` for DB migrations.

## Why this is hard

Continuous mode must not be expensive (running RTD every hour is wasteful) or noisy (notifying on every flap). Debouncing + intelligent invalidation + per-family re-run heuristics are core. Migration profile needs a completely different trust model (two-party, reversibility check, dry-run first).

## Scope

### In
- Stage-based triggers (hooks into CI, git, connector events).
- Continuous mode configuration per project.
- Regression detector (verdict drift).
- Guided mode wizard for new users.
- `executor.migration@1.0.0` profile + workflow.

### Out
- LLM-driven root-cause analysis for regressions (future).
- Cross-project meta-dashboard (future).

## Deliverables

```
apps/local-bridge/src/
├── orchestrator/
│   ├── mod.rs
│   ├── stage_triggers.rs
│   ├── continuous.rs
│   ├── regression.rs
│   └── guided.rs
├── migration/
│   ├── mod.rs
│   ├── dry_run.rs
│   ├── two_party.rs
│   └── reversibility.rs
apps/web/src/components/
├── GuidedMode/
│   ├── GuidedMode.tsx
│   ├── WizardStep.tsx
│   ├── ProjectTypePicker.tsx
│   ├── ReleaseGoalPicker.tsx
│   └── FamilyRecommender.tsx
└── ContinuousDashboard/
    ├── ContinuousDashboard.tsx
    ├── ReadinessTrend.tsx
    └── RegressionAlert.tsx
```

## Stages

### S1 — Stage triggers (0.5 week)

Subscribe to events that warrant re-assessment:
- `pr.merged` (GitHub webhook OR polling via connector).
- `branch.pushed` to protected refs.
- `ci.build.complete` (via CI connector).
- `release.tagged`.

Rules config per project `.vac-web/triggers.yaml`:
```yaml
triggers:
  - on: pr.merged
    into: main
    run: [rtd, pm, security]
  - on: ci.build.complete
    status: success
    run: [rtd]
  - on: branch.pushed
    ref: "release/*"
    run: [release_readiness]
```

Executor: debounced 60s (burst of PRs doesn't spawn 10 runs).

**Exit**: PR merged → relevant assessments scheduled.

### S2 — Continuous mode (0.5 week)

Per project: opt-in setting "Maintain live readiness score."

Scheduler: for each enabled family, re-run on `auto_reevaluate_every` (default 6h). Uses cheaper `quick` depth unless full ran < 24h ago.

Cost controls:
- Daily token budget per project (configurable).
- Pause if budget exhausted.
- User-visible spend dashboard.

**Exit**: continuous mode runs scheduled assessments; budget enforced.

### S3 — Regression detector (0.3 week)

On every completed assessment, compare verdict with most recent of same family:
- Green → red: regression. Emit sticky banner + email alert (optional).
- Green → yellow: warning.
- New critical finding: regression per-category.

Persist trend timeline; expose via `ReadinessTrend` component.

**Exit**: synthetic regression triggers alert within 5 min of detection.

### S4 — Guided mode (0.5 week)

First-time user experience:
1. "What kind of project is this?" (landing page / SaaS backend / mobile app / library / internal tool).
2. "What's your release goal?" (demo / beta launch / production deploy / growth milestone).
3. Recommender: curated assessor subset (e.g., landing page → PM + UX + Launch; SaaS backend → RTD + Security + Reliability).
4. Walks user through first run with explanations.
5. Explains verdict with links to relevant docs.

Non-technical founder can reach verdict without reading all our docs.

**Exit**: 3 personas complete guided mode ≤ 15 min each, understand outcome.

### S5 — Continuous dashboard (0.3 week)

Dashboard view showing:
- Timeline per family verdict (sparkline).
- Current readiness score across families.
- Budget consumption.
- Recent regressions.
- Drift badges (assessments > fresh_until).

Pinnable; homepage when returning to project.

**Exit**: dashboard renders; clickthrough to detail.

### S6 — `executor.migration@1.0.0` (0.5 week)

Profile design:
- `tool_allow`: `db.migrate.*`, `db.backfill.*`, `read_file`, `git_read`.
- `approval_required_for: ["db.migrate.up", "db.migrate.down", "db.backfill.*"]`.
- Two-party mandatory.
- Dry-run required before real run.

Workflow:
1. Assessor (new family or extension of RTD) identifies migration as pending.
2. Handoff created with target `executor.migration@1.0.0`.
3. Dry run: `db.migrate.up --dry-run` → outputs plan + rollback confirmation.
4. Both approvers review dry run.
5. Real migration + backup snapshot.
6. Rollback on failure.

Reversibility check: if migration is marked irreversible, extra confirmation layer ("This migration has no down script — confirm?").

**Exit**: migration executor profile works on fixture db.

### S7 — Migration UI (0.2 week)

Special UI for migration handoffs: dry-run panel + apply panel + rollback button. Visible under Release plane.

**Exit**: UI visible + functional.

### S8 — Advanced connectors (ongoing)

Per user demand. Template from Plan 24.

**Exit**: as connectors land, document in catalog.

## Testing

- Trigger: mock PR merge → assessment scheduled.
- Continuous: synthetic time acceleration verifies scheduler.
- Regression: inject verdict change, assert alert.
- Guided mode: user test with 3 personas.
- Migration: dry-run + apply on test DB.

## Exit criteria

- [ ] Triggers running per project config.
- [ ] Continuous mode functional + budgeted.
- [ ] Regression alerts on verdict drift.
- [ ] Guided mode completes successfully for primary personas.
- [ ] Migration profile available + safe (red-team cases added).

## Risks

| Risk | Mitigation |
|---|---|
| Trigger storm on noisy repos | Debounce + budget |
| Continuous cost surprises | Per-project budget default; hard stop |
| Regression alerts noise | Severity filtering + user-tunable thresholds |
| Migration profile catastrophic bug | Dry-run + two-party + rollback + backup + staging-only default |

## Related

- [`capability-profiles.md`](../../capability-profiles.md) §4.2 — migration profile (deferred from v1)
- [`roadmap.md`](../../roadmap.md) — Phase 8 scope
- Plan 26 — runs scheduled by orchestrator
- Plan 30 — gates reflect trends
