# Phase 2.3 — Command Palette + ActionSpec

**Duration**: 1 day
**Position**: after Phase 2.2 (syntax highlight); before Phase 2.4 (topbar + notify)
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Implement universal `⌘K`/`Ctrl+K` command palette populated from `ActionSpec[]` emitted by the bridge. Profile-aware disabling. Slash-alias integration in composer. Recency-weighted ordering.

## Entry criteria

- Phase 2.2 exit: transcript + markdown + highlight all green.
- Bridge emits `system.capabilities` event on session.ready (needs small bridge addition).

## Scope

### In
- **Bridge** (small patch): on session.ready, emit `system.capabilities` event with inline `ActionSpec[]` list.
- **Web**: `actions/registry.ts` Zustand slice populated from `system.capabilities`.
- **Web**: `actions/predicate.ts` — safe expression interpreter for `availableWhen` (no eval).
- **Web**: `actions/recency.ts` — localStorage-persisted usage counts, 5-minute bonus + 1-hour bonus.
- **Web**: `<CommandPalette/>` overlay with fuzzy filter (`fuse.js` or inline) + grouped display.
- **Web**: Composer `/`-trigger opens slash-alias picker (subset of palette).
- Keyboard: `Ctrl/⌘+K` open, `↑/↓` navigate, `Enter` invoke, `Esc` close.
- Profile-aware greyed rendering with tooltip reason.

### Out
- Per-action modal prep UI (e.g., file picker). Palette just dispatches `palette.invoke_action`; action-specific UX comes per-feature.
- Overlay manager (Phase 2.5 — palette is technically an overlay but embeds itself for now; migrates when 2.5 lands).

## Granular plan

[`docs/plans/phase-2/17-command-palette.md`](../phase-2/17-command-palette.md)

## Day-by-day

### Day 1 — Full implementation

Morning (bridge side, ~1h):
- `apps/local-bridge/src/server.rs`: at session.ready, emit accompanying `system.capabilities` event containing a hard-coded `ActionSpec[]` list for v1 (expand over time).
- Integration test confirms capability event arrives.

Morning (web, ~2h):
- `actions/registry.ts` — store + init from event.
- `actions/predicate.ts` — pratt-style parser; allowed ops: `&&`, `||`, `!`, `==`, `!=`, `>`, `<`, `>=`, `<=`, member access.
- Unit tests: 10+ predicate cases (valid + invalid).
- `actions/recency.ts` — track last-used timestamps; top-up at invoke.

Afternoon (~4h):
- `<CommandPalette/>` component — `Dialog` + autofocus input + virtualized list (reuse TanStack Virtual).
- Fuzzy filter: inline small fuzzy matcher (~60 LOC) vs. `fuse.js` — decide based on bundle.
- Grouped display: actions grouped by `ActionSpec.group`; priority list `Build, Assess, Handoff, Release, Session, System`.
- Disabled action rendering with reason tooltip.
- Invoke path: `transport.send(sessionId, 'palette.invoke_action', { actionId, args })`.
- `/` slash trigger in Composer: detects leading slash, opens inline matcher.

## Deliverables

```
apps/local-bridge/src/server.rs       (patched)
apps/web/src/
├── actions/
│   ├── registry.ts
│   ├── predicate.ts
│   ├── recency.ts
│   ├── fuzzy.ts
│   └── slash.ts
└── components/
    └── CommandPalette/
        ├── CommandPalette.tsx
        ├── PaletteRow.tsx
        ├── GroupHeader.tsx
        └── index.ts
```

## Exit criteria (gate to Phase 2.4)

- [ ] `⌘K` opens palette; action list populated from bridge.
- [ ] Fuzzy search narrows results; Enter invokes.
- [ ] Disabled actions greyed with reason.
- [ ] Recency boosts recently-used actions.
- [ ] Slash `/rtd` in composer mirrors palette invoke.
- [ ] Predicate interpreter unit tests green (≥ 10 cases).
- [ ] `pnpm -r typecheck` green.
- [ ] No console errors on open/close/invoke cycle.

## Risks

| Risk | Mitigation |
|---|---|
| `availableWhen` footgun (hidden eval) | No JS eval; hand-rolled parser; rejects unknown tokens |
| Palette re-renders on unrelated store updates | Selectors scoped to `registry.actions` + `context.predicateCtx` only |
| Slash collides with code fences in composer | Trigger only if slash is first char of line + followed by letter |
| Fuzzy filter slow at 500+ actions | Pre-index; cap result set to 50 |

## Related

- [`docs/ux-grammar.md §8`](../../ux-grammar.md) — ActionSpec + palette spec
- Plan 17 — granular

## Handoff to Phase 2.4

Phase 2.4 (topbar + notify lanes) uses similar keyboard shortcut pattern + overlay layering. The shortcut handler added here should coexist cleanly.
