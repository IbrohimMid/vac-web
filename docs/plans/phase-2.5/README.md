# Phase 2.5 — Overlay Manager

**Duration**: 1 day
**Position**: after Phase 2.4 (notify lanes); before Phase 2.6 (exit)
**Status**: ✅ **DONE** (implemented; see vite build + vitest suite)

## Goal

Implement the semantic overlay stack: max depth 2, Esc precedence, focus restore, multi-client sync via `overlay.opened`/`overlay.dismissed` events. Migrate `CommandPalette` from Phase 2.3 into this manager. Prepare ground for Phase 3 overlays (approval_inspector, diff_viewer, shell_drawer, gate_detail).

## Entry criteria

- Phase 2.4 exit: Topbar + notify lanes green.
- `CommandPalette` working (self-managed modal); ready for migration.

## Scope

### In
- `stores/overlays.ts` — Zustand slice: stack[], open(), dismiss(), dismissAll().
- `OverlayKind` enum matching `ux-grammar.md §5` (+ registry mapping kind → lazy-loaded component).
- `<OverlayHost/>` root component — portals, backdrop, stack order, z-index layering.
- Focus trap + restore via `focus-trap-react` (or ~50 LOC hand-rolled).
- Global Esc handler with precedence (innermost first).
- Multi-client sync via bridge `overlay.open`/`overlay.dismiss` commands + server `overlay.opened`/`.dismissed` events.
- Migrate `CommandPalette` to be overlay kind `command_palette`.
- Responsive: overlay kind can declare `preferred: 'modal' | 'split_pane'` based on viewport.
- Body scroll lock when stack non-empty.
- Max stack depth 2 — opening a 3rd dismisses bottom.

### Out
- Specific overlay content beyond palette (each epic owns its own overlay content).
- Per-overlay persistence across sessions.

## Granular plan

[`docs/plans/phase-2/19-overlay-manager.md`](../phase-2/19-overlay-manager.md)

## Day-by-day

### Day 1 — Full implementation

Morning:
- `stores/overlays.ts` — stack reducer + tests.
- `overlays/registry.ts` — kind → lazy component map.
- `overlays/focus.ts` — save on open, restore on dismiss.
- `overlays/esc.ts` — global keydown listener, precedence.
- `<OverlayHost/>` mounted at app root.

Afternoon:
- Migrate `CommandPalette` to kind `command_palette`; keyboard shortcut opens via `useOverlays.getState().open('command_palette')`.
- Multi-client sync wiring: outgoing `overlay.open` cmd → bridge broadcasts → incoming `overlay.opened` event → other clients mirror (if syncable=true).
- Responsive: `<OverlayHost/>` reads viewport + passes `presentation: 'modal' | 'split_pane'` to component.
- Tests: stack depth cap, focus restore, Esc precedence, palette migration works identically.

## Deliverables

```
apps/web/src/
├── stores/overlays.ts
├── overlays/
│   ├── registry.ts
│   ├── focus.ts
│   ├── esc.ts
│   ├── sync.ts           (multi-client bridge)
│   └── responsive.ts
└── components/OverlayHost/
    ├── OverlayHost.tsx
    └── OverlayBackdrop.tsx
```

## Exit criteria (gate to Phase 2.6)

- [ ] Max depth 2 enforced (3rd open → bottom dismissed).
- [ ] Esc dismisses innermost; second Esc dismisses outer.
- [ ] Focus restored to element that opened overlay.
- [ ] CommandPalette works identically post-migration.
- [ ] Two-tab test: open palette in tab A → other tab receives event (if syncable, though palette is typically NOT synced).
- [ ] Body scroll locked while stack non-empty.
- [ ] `pnpm typecheck` + `vite build` green; bundle increase ≤ 15KB gz.

## Risks

| Risk | Mitigation |
|---|---|
| Focus trap library conflicts with React concurrent mode | Test with StrictMode; hand-rolled fallback (~50 LOC) if needed |
| Backdrop click bubbles into overlay content | `e.target === backdrop` exact check |
| Portal causes SSR issues | No SSR in v1; document constraint |
| Over-syncing between clients causes clutter | Per-kind `syncable` flag; default false for user-local kinds |

## Related

- [`docs/ux-grammar.md §5`](../../ux-grammar.md) — overlay semantics
- Plan 19 — granular

## Handoff to Phase 2.6

Phase 2.6 adds perf baselines + red-team expansion + Phase 2 exit. Overlay manager is infrastructure; Phase 3 will populate it heavily (approval_inspector, diff_viewer, shell_drawer).
