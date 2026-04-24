# Phase 2.4 — UX Grammar: Topbar + Notify Lanes + Activity Rail

**Duration**: 1.5 days
**Position**: after Phase 2.3 (palette); before Phase 2.5 (overlay manager)
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Materialize the UX grammar that makes the cockpit **feel** like VAC: severity glyphs (`✓·●✗`), subsystem labels, three notify lanes (transient/persistent/sticky), clickable system-pulse facets in Topbar, activity timeline in right rail.

This is the "feel" pass — no new functionality beyond what the bridge already emits; we surface it consistently.

## Entry criteria

- Phase 2.3 exit: command palette functional.
- Bridge emits `notify.event`, `system_pulse.updated`, `activity.appended` (needs small additions).

## Scope

### In
- **Bridge patches**: aggregate system_pulse facets (model, session count, pending approvals, gate summary) + emit on state change; emit `notify.event` on key transitions (session ready/closed, profile denied, etc.); emit `activity.appended` for session lifecycle.
- **Web**: color tokens per `ux-grammar.md §10` (severity colors, surface colors, theme support).
- **Web**: `<SeverityIcon severity>` — unicode glyph + color token + ARIA label.
- **Web**: `<Topbar/>` with session title + `system_pulse.facets[]` chips clickable.
- **Web**: Notify lane system — 3 lanes wired to bridge-authoritative routing:
  - `<TransientToasts/>` — top-right stack, auto-dismiss 3–5s.
  - `<PersistentRail/>` — right sidebar, manual dismiss.
  - `<StickyBanners/>` — below topbar, until server clears or user dismiss.
- **Web**: `<ActivityRail/>` — virtualized timeline; entries have `detailRef` + `actionId` link.
- Keyboard: `Alt+A` focus activity rail, `Alt+P` focus persistent rail (non-blocking).

### Out
- Gate ribbon (Phase 4 — `ReadinessHub` consumes).
- Palette grammar hookup (already done in 2.3).

## Granular plan

[`docs/plans/phase-2/18-topbar-notify.md`](../phase-2/18-topbar-notify.md)

## Day-by-day

### Day 1 — Bridge emissions + tokens + SeverityIcon
Morning (bridge, ~2h):
- `apps/local-bridge/src/system_pulse.rs` (new) — aggregates session count + profile + pending approvals; emits `system_pulse.updated` on change.
- `apps/local-bridge/src/notify.rs` (new) — `NotifyRouter` maps events → lane/severity per `ux-grammar.md §4`.
- Wire: session lifecycle + profile denials + auth failures → notify.event emissions.

Afternoon (web, ~4h):
- `styles/tokens.css` — severity color vars + dark theme variants.
- `styles/theme.ts` — system preference detection + manual override.
- `<SeverityIcon/>` + `<SubsystemLabel/>` components.
- `stores/notify.ts` with 3 lanes.
- `stores/systemPulse.ts` + `stores/activity.ts`.
- Event handlers wire queue → stores.

### Day 2 — Components + polish
- `<Topbar/>` with `<FacetChip/>` cells.
- `<TransientToasts/>` with slide animation.
- `<PersistentRail/>` + virtualization at 100+ entries.
- `<StickyBanners/>` — reserved-space layout above main.
- `<ActivityRail/>` + filter by subsystem/severity.
- Integration test: synthetic server events land in expected lanes with correct glyphs.
- A11y audit: axe-core on every new component.

## Deliverables

```
apps/local-bridge/src/
├── system_pulse.rs          (new)
├── notify.rs                (new)
└── translator/mod.rs        (patched to emit through NotifyRouter)

apps/web/src/
├── styles/
│   ├── tokens.css
│   └── theme.ts
├── stores/
│   ├── notify.ts
│   ├── systemPulse.ts
│   └── activity.ts
├── components/
│   ├── SeverityIcon.tsx
│   ├── Topbar/
│   │   ├── Topbar.tsx
│   │   ├── FacetChip.tsx
│   │   └── SessionTitle.tsx
│   ├── NotifyLane/
│   │   ├── TransientToasts.tsx
│   │   ├── PersistentRail.tsx
│   │   └── StickyBanners.tsx
│   └── ActivityRail/
│       ├── ActivityRail.tsx
│       └── ActivityEntry.tsx
```

## Exit criteria (gate to Phase 2.5)

- [ ] All 4 severities render with glyph + color + ARIA label.
- [ ] Transient toasts auto-dismiss; persistent rail manual dismiss; sticky survive until clear.
- [ ] Topbar facet chips react to bridge state changes (create session → chip updates).
- [ ] Activity rail populated from `activity.appended` events; virtualized at 5k entries.
- [ ] Keyboard focus shortcuts work.
- [ ] axe-core a11y pass on Topbar + NotifyLane + ActivityRail.
- [ ] Bridge integration test: synthetic NotifyEvent → matches expected lane in rendered UI.
- [ ] Bundle increase ≤ 30KB gzipped.

## Risks

| Risk | Mitigation |
|---|---|
| Sticky banner causes layout shift | Reserve space via CSS `min-height`; test with banner on/off |
| Toast queue overflow lost | Cap 3 visible + queue up to 10; overflow shows "+N more" indicator |
| Activity rail unbounded growth | Cap in-memory to last 1000; older → IndexedDB (Phase 3+) |
| Theme tokens drift vs TUI | `ux-grammar.md §10` is SSOT; Percy snapshots locked |

## Related

- [`docs/ux-grammar.md`](../../ux-grammar.md) §2 (severity), §4 (lanes), §6 (system pulse)
- Plan 18 — granular

## Handoff to Phase 2.5

Phase 2.5 (overlay manager) will move palette + future modals into a proper overlay stack. Topbar + notify lanes stay outside the stack (always visible); overlay stacking happens above them.
