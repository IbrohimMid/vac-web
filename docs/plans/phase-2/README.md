# Phase 2 — Build Cockpit Core

**Total duration**: ~9 days (6 sub-phases)
**Position**: after Phase 1.7 (end-to-end stack green); before Phase 3 (workbench tabs)
**Status**: 🔴 **NOT STARTED**

## Goal

Turn the Phase 1 ugly-but-functional stack into a daily-drivable cockpit. Three tracks run in parallel:

1. **Rendering quality** — markdown, syntax highlight, virtualization, hot/cold freeze.
2. **UX grammar** — severity glyphs, notify lanes, activity rail, Topbar facets, command palette.
3. **Architecture** — overlay manager as infrastructure for all Phase 3+ modals.

Exit criteria: user can run a full session with polished text, pull up `⌘K`, see system state at glance, dismiss and re-focus cleanly.

## Sub-phase map

| Sub-phase | Focus | Days | Granular plans |
|---|---|---|---|
| [**2.1**](../phase-2.1/README.md) | Transcript architecture (hot/cold + markdown) | 3 | 14, 15 |
| [**2.2**](../phase-2.2/README.md) | Syntax highlight (Shiki worker) | 1 | 16 |
| [**2.3**](../phase-2.3/README.md) | Command palette + ActionSpec | 1 | 17 |
| [**2.4**](../phase-2.4/README.md) | Topbar + notify lanes + activity rail | 1.5 | 18 |
| [**2.5**](../phase-2.5/README.md) | Overlay manager | 1 | 19 |
| [**2.6**](../phase-2.6/README.md) | Perf baselines + red-team + exit gate | 1.5 | — |

## Critical path

Linear: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6. Each sub-phase depends on the previous.

- 2.1 establishes the transcript store shape + markdown rendering path.
- 2.2 hooks syntax highlight into the `<pre data-lang>` blocks 2.1 emits.
- 2.3 introduces overlay-like `CommandPalette` (embedded for now).
- 2.4 adds the grammar infrastructure that all future UI reads from.
- 2.5 migrates palette into a proper overlay stack + prepares for Phase 3 modals.
- 2.6 locks exit gate with benchmarks + red-team + status sweep.

## Prerequisites

- Phase 1.7 green: 94+ workspace tests, TS strict, vite build.
- `pnpm install` available; markdown-it + DOMPurify + Shiki + fuse.js installable.
- Bridge stable (audit trail, profile enforcement, broadcast) — no breaking changes expected.

## What's explicitly OUT of Phase 2

- **Workbench tabs** (Approvals, Review, Sessions, Runtime, Shell, Connectors) — Phase 3.
- **Assessment UI** (Readiness Hub, AssessmentReport, findings) — Phase 4.
- **Handoff builder** — Phase 5.
- **Release plane** — Phase 6.

The cockpit at end of Phase 2 is **beautiful but empty** beyond the core transcript. Phase 3 fills the workbench.

## Cross-cutting concerns

### Perf budgets (enforced at each sub-phase exit)
- FPS p95 during streaming: ≥ 50.
- Active DOM nodes at 10k messages: ≤ 8,000.
- Initial bundle: ≤ 250KB gz; post-Phase-2 total ≤ 650KB gz.
- Time-to-first-token paint: ≤ 50ms.

### Red-team expansion
Phase 2 adds UI-layer cases on top of Phase 1's 15 bridge-layer cases:
- XSS sanitizer bypass.
- Profile-denied palette invoke.
- Overlay abuse (rapid open/dismiss, depth excess).
- Notify-event schema violations.

Target: 25+ red-team cases by Phase 2 exit.

### Bridge emissions expanded
Small bridge patches across 2.3 + 2.4:
- `system.capabilities` event emitted on session.ready (2.3).
- `system_pulse.updated` on session-state changes (2.4).
- `notify.event` routed via `NotifyRouter` (2.4).
- `activity.appended` for session lifecycle (2.4).

All additive; no protocol breaking changes.

## Phase 2 exit criteria (gate to Phase 3)

From Phase 2.6:

- [ ] All 2.1–2.5 sub-phases hit their exit criteria.
- [ ] Perf baselines captured + within budgets.
- [ ] UI red-team ≥ 10 cases green.
- [ ] E2E smoke: pair → session → markdown streaming → palette → notify → overlay → close.
- [ ] Workspace tests ≥ 110; red-team ≥ 20.
- [ ] All 2.x READMEs marked ✅.
- [ ] Root README + plans README updated.

## Rollback plan

If Phase 2 exit perf regresses Phase 1 baselines > 15%:
1. Defer Phase 2.6 perf gate to Phase 3 Planning.
2. File issue listing regressed metrics.
3. Ship Phase 2 features behind a feature flag pending investigation.

Phase 2 is additive — rollback = disable new UI paths, not full revert.

## Related

- [`docs/roadmap.md §3`](../../roadmap.md) — Phase 2 in roadmap context.
- [`docs/frontend-rules.md`](../../frontend-rules.md) — architecture rules enforced here.
- [`docs/perf-test-plan.md`](../../perf-test-plan.md) — bench specs.
- [`docs/ux-grammar.md`](../../ux-grammar.md) — SSOT for 2.4.

## Execution policy

Run sub-phases sequentially, not in parallel — each depends on the previous infrastructure. Budget contingency: if a sub-phase exceeds estimate by > 50%, stop + re-scope; don't cascade overrun.
