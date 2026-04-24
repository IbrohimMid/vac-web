# Phase 2.6 — Phase 2 Exit: Perf Baselines + Red-Team + Polish

**Duration**: 1.5 days
**Position**: final sub-phase of Phase 2; gate to Phase 3
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Lock Phase 2 complete: stress-test the cockpit, capture perf baselines for the hot paths, extend red-team with UI-layer cases, fix any integration bugs discovered, update all sub-phase README statuses, cut Phase 2 tag.

## Entry criteria

- Phases 2.1–2.5 all exit criteria met.
- Workspace tests ≥ 100 passing.
- `pnpm -r build` green; TS strict clean.

## Scope

### In
- **Perf baselines** captured + committed:
  - `bench:transcript` — 10k messages, 500 tokens/s streaming, 60s → FPS, heap, listener count.
  - `bench:bundle` — initial + per-chunk sizes.
  - `bench:cold-start` — fresh page → first-message paint.
  - `bench:palette` — open + filter + invoke round-trip.
- **Red-team expansion** — 5+ new cases at UI layer:
  - Sanitizer bypass attempts (XSS vectors in message content).
  - Palette invoke of denied action → grey + reject.
  - Overlay depth abuse (rapid open/dismiss cycles).
  - Notify lane spoofing (server emits fake notify.event → client accepts but schema validates).
- **Integration smoke** — full cockpit flow: pair → session → streaming → palette → notify → overlay → close.
- **Sub-phase status** — update all 2.x READMEs to ✅ done.
- **Root README + plans README** — mark Phase 2 complete.
- **Bug fixes** — triage + fix any issues surfaced by stress tests.

### Out
- Phase 3 features (workbench tabs).
- Production deployment concerns.

## Granular plan

No single plan file for this phase; it's the stress test + gate.

## Day-by-day

### Day 1 — Perf baselines
Morning (~3h):
- Install Playwright in `apps/web/`.
- Write `bench:transcript` spec — simulated 10k-message fixture + streaming.
- Capture baseline JSON → `perf/baselines/phase-2-transcript.json`.
- Write `bench:bundle` check using size-limit.

Afternoon (~4h):
- `bench:cold-start` — navigate to app → measure FCP/TTI → first message visible.
- `bench:palette` — Ctrl+K → filter → Enter (scripted keyboard).
- Compare to Phase 1.7 baselines; identify regressions > 15%.
- Fix any regression blocker.

### Day 2 — Red-team + integration + exit
Morning (~3h):
- `tests/red-team/tests/red_team_ui.rs` (or equivalent in Playwright layer).
- Sanitizer bypass harness — 10+ XSS vectors → all neutralized in rendered HTML.
- Profile-denied palette invoke → ack error + no state change.
- Extend bridge red-team: overlay spam cap.

Afternoon (~4h):
- Full flow smoke (manual + automated): pair → session → message → palette → notify → overlay → close.
- Fix any issues.
- Update 2.1–2.5 READMEs status.
- Update root README + plans README.
- Commit Phase 2 tag.

## Deliverables

```
apps/web/
├── playwright.config.ts
├── e2e/
│   ├── happy-path.spec.ts
│   ├── palette.spec.ts
│   └── streaming-perf.spec.ts
perf/baselines/
├── phase-2-transcript.json
├── phase-2-bundle.json
├── phase-2-cold-start.json
└── phase-2-palette.json
tests/red-team/tests/red_team_ui.rs      (or equivalent Playwright)
docs/plans/phase-2.{1,2,3,4,5}/README.md  (status updated)
```

## Exit criteria (gate to Phase 3)

- [ ] `bench:transcript` — FPS p95 ≥ 50 during streaming; heap ≤ 50MB growth in 60s; 0 listener leak.
- [ ] `bench:bundle` — initial ≤ 250KB gz; phase-2 additions ≤ 400KB gz combined.
- [ ] `bench:cold-start` — FCP ≤ 1200ms, TTI ≤ 2500ms.
- [ ] `bench:palette` — open+filter+invoke < 300ms p95.
- [ ] UI red-team: 10+ XSS vectors neutralized.
- [ ] E2E smoke: pair → session → message → palette → close passes headless.
- [ ] Workspace tests ≥ 110; red-team ≥ 20 cases.
- [ ] All 2.x sub-phase READMEs marked ✅ done.

## Risks

| Risk | Mitigation |
|---|---|
| Playwright flaky on CI | Retry budget 2; deterministic mock-engine seeds |
| Perf baselines differ per machine | Track % change only; use `VAC_WEB_PERF_PROFILE=laptop` |
| UI red-team needs live browser | Acceptable; run in separate workflow with longer timeout |
| Perf regression blocker | Triage: fix in 2.6 if < 1 day work; else defer + document |

## Related

- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench targets authoritative
- [`docs/red-team-test-plan.md`](../../red-team-test-plan.md) — case catalog
- [Phase 3 plans](../phase-3/) — next iteration foundations

## Phase 2 summary

At Phase 2 exit:
- Transcript is production-quality: markdown + syntax highlight + hot/cold + virtualized.
- Palette + slash commands turn bridge actions into first-class operations.
- Topbar + notify lanes + activity rail make system state legible at glance.
- Overlay manager ready to host all future modals (approval inspector, diff viewer, shell drawer, gate detail, handoff builder, assessment report).

Phase 3 adds **execution surfaces**: real workbench tabs wired to live engine activity (approvals, review, sessions, runtime, shell, connectors).
