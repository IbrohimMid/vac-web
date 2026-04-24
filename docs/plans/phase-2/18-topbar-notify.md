# Plan 18 — Topbar system pulse + notify lanes + activity rail

**Phase**: 2 · **Depends on**: Plan 12, 13 · **Blocks**: Phase 2 exit · **Est**: 1.5 days

## Goal

Materialize the UX grammar: severity glyphs everywhere, clickable facet chips in the Topbar, three notification lanes (transient, persistent, sticky), activity timeline. This is the "feel" of the cockpit — the part users pattern-match on.

## Why this is hard

Notify lane routing is decided **server-side** (bridge) per `ux-grammar.md §4`. Client must render correctly regardless of routing choices. Plus: sticky banners interact with Topbar layout (they can't push content); transient toasts must not overlap persistent ones; activity rail must not rerender on every tick.

## Scope

### In
- Topbar with session info + `system_pulse.facets` chips.
- Severity glyph + color tokens (`ux-grammar.md §2, §10`).
- NotifyLane system: transient toasts + persistent rail + sticky banners.
- ActivityRail component with timeline entries.
- Router-less navigation hints via `actionId` on notify/activity entries.

### Out
- Gate ribbon (Plan 30 adds).
- Pairing UI (Plan 11 bridge + minimal client).

## Deliverables

```
apps/web/src/
├── components/
│   ├── Topbar/
│   │   ├── Topbar.tsx
│   │   ├── FacetChip.tsx
│   │   └── SessionTitle.tsx
│   ├── NotifyLane/
│   │   ├── TransientToasts.tsx
│   │   ├── PersistentRail.tsx
│   │   ├── StickyBanners.tsx
│   │   └── SeverityIcon.tsx
│   └── ActivityRail/
│       ├── ActivityRail.tsx
│       └── ActivityEntry.tsx
├── stores/
│   ├── notify.ts
│   ├── systemPulse.ts
│   └── activity.ts
├── styles/
│   ├── tokens.css             # severity colors per ux-grammar §10
│   └── severity.module.css
```

## Stages

### S1 — Tokens + SeverityIcon (0.2 day)

`styles/tokens.css`:
```css
:root {
  --sev-ok:    hsl(152 60% 40%);
  --sev-info:  hsl(215 16% 47%);
  --sev-warn:  hsl(38  92% 50%);
  --sev-error: hsl(354 70% 54%);
}
[data-theme="dark"] { --sev-ok: hsl(152 50% 50%); ... }
```

`<SeverityIcon severity="warn">`:
- Unicode glyph `✓ · ● ✗`.
- ARIA `role="img"` + `aria-label="<severity>"` — a11y non-color indicator.
- CSS `color: var(--sev-<severity>)`.

**Exit**: all 4 glyphs render correctly in light + dark; screen reader announces label.

### S2 — Notify store (0.2 day)

```ts
interface NotifySlice {
  transient: NotifyEvent[];        // auto-expiring
  persistent: NotifyEvent[];       // manual dismiss
  sticky: Map<string, NotifyEvent>;// keyed by correlationId
  receive(ev: NotifyEvent): void;
  dismiss(id: string): void;
  pinToSticky(id: string): void;
  clearSticky(correlationId: string): void;
}
```

Transient: auto-dismiss after `severity === 'ok' ? 3000 : 5000` ms.
Persistent: stays until dismissed.
Sticky: keyed by `correlationId` (e.g., `gate.ready_to_deploy`); new event with same id **replaces** rather than stacks.

**Exit**: store reducers unit-tested.

### S3 — `notify.event` handler (0.1 day)

Register on event queue:
```ts
queue.on('notify.event', (ev) => useNotifyStore.getState().receive(ev.payload));
```

Lane is determined by event.payload.lane (server-authoritative). Client never moves events between lanes unless user pins.

**Exit**: synthetic server events land in expected lane.

### S4 — TransientToasts (0.2 day)

```tsx
function TransientToasts() {
  const items = useNotifyStore(s => s.transient);
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map(n => <Toast key={n.id} notify={n} />)}
    </div>
  );
}
```

Animation: slide-in from top-right, fade-out after TTL. Limit 3 visible at a time; overflow queued.

Click: invoke `actionId` if present + dismiss.

**Exit**: 10 rapid toasts don't overlap or cause layout shift.

### S5 — PersistentRail (0.2 day)

Right sidebar component (collapsible).
```tsx
function PersistentRail() {
  const items = useNotifyStore(s => s.persistent, shallow);
  return (
    <aside className="persistent-rail">
      <header>Activity</header>
      {items.map(n => (
        <div key={n.id} className="rail-entry" data-severity={n.severity}>
          <SeverityIcon severity={n.severity} />
          <div>
            <strong>{n.subsystem}</strong>
            <p>{n.title}</p>
          </div>
          <button onClick={() => dismiss(n.id)}>✕</button>
        </div>
      ))}
    </aside>
  );
}
```

Virtualized if > 100 entries.

**Exit**: entries stack; dismiss works; virtual scrolling tested with 1000 entries.

### S6 — StickyBanners (0.2 day)

Top of page, below Topbar, one band per sticky entry:
```tsx
function StickyBanners() {
  const items = [...useNotifyStore(s => s.sticky.values())];
  if (items.length === 0) return null;
  return (
    <div className="sticky-banners">
      {items.map(n => (
        <div className="banner" data-severity={n.severity} key={n.id}>
          <SeverityIcon severity={n.severity} />
          <span>{n.message}</span>
          {n.actionId && <button onClick={...}>{n.actionLabel}</button>}
        </div>
      ))}
    </div>
  );
}
```

ARIA: `aria-live="assertive"` for critical severity.

Sticky never auto-dismisses; disappears only when server clears (`notify.event` with same correlationId + different state) or user dismiss.

**Exit**: gate red banner visible until state changes.

### S7 — Topbar + system pulse (0.2 day)

```tsx
function Topbar() {
  const session = useSession();
  const facets = useSystemPulse(s => s.facets);
  return (
    <header className="topbar">
      <SessionTitle session={session} />
      <nav className="facets">
        {facets.map(f => <FacetChip key={f.kind + f.label} facet={f} />)}
      </nav>
    </header>
  );
}

function FacetChip({ facet }) {
  return (
    <button
      data-kind={facet.kind}
      data-severity={facet.severity}
      onClick={() => invoke(facet.actionId)}
    >
      <SeverityIcon severity={facet.severity} />
      <span>{facet.label}</span>
    </button>
  );
}
```

Hidden facets (per `ux-grammar.md §6`) simply not emitted by server.

`system_pulse.updated` event updates store; Topbar re-renders only on change (shallow compare).

**Exit**: model switch chip, token count chip, pending-approvals chip render correctly.

### S8 — ActivityRail (0.2 day)

```tsx
function ActivityRail() {
  const entries = useActivity(s => s.entries, shallow);
  return (
    <aside>
      <Virtualized items={entries} renderItem={e => <ActivityEntry entry={e} />} />
    </aside>
  );
}
```

Entries from `activity.appended` events. Each has timestamp, severity, subsystem, summary, optional `detailRef` + `actionId`.

Click: navigate to detail (e.g., open handoff detail drawer).

Filters: by subsystem, severity.

**Exit**: activity entries stream in; filters work; virtualization smooth at 5k entries.

### S9 — Polishing: layout + a11y (0.2 day)

- Topbar height consistent (`--topbar-h: 48px`).
- Sticky banners below Topbar, above main.
- Persistent rail + activity rail: can user toggle in single-column mode?
- Toasts overlay; z-index discipline via CSS variables.
- Full keyboard: palette-accessible shortcuts: `Alt+A` focus activity rail, `Alt+P` focus persistent rail.

**Exit**: keyboard-only user can reach every notify entry.

## Testing

- Visual snapshot (Percy) per severity.
- Keyboard E2E.
- Stress: 10k notify events in 60s; UI stays responsive.
- Screen reader audit via axe-core.

## Exit criteria

- [ ] All 4 severities render with correct glyph + color + ARIA label.
- [ ] 3 lanes route correctly per server event.
- [ ] Sticky banner appears on gate red, clears on gate green.
- [ ] Topbar facet chips clickable; disabled facets hidden.
- [ ] Activity rail virtualizes; filters work.
- [ ] Keyboard a11y passes axe.

## Risks

| Risk | Mitigation |
|---|---|
| Sticky banner causes layout shift | Reserve space via CSS `min-height` or shift content below smoothly |
| Toast queue overflow lost | Cap 3 visible, queue up to 10, drop oldest beyond with a single "… N more" indicator |
| Activity rail memory grow | Cap retained entries to last 1000; older archived to IndexedDB lazy |
| Theme tokens drift vs TUI | `ux-grammar.md §10` is SSOT; Percy snapshots per theme |

## Related

- [`ux-grammar.md`](../../ux-grammar.md) §2, §4, §6
- Plan 13 — app shell hosts Topbar
- Plan 17 — palette shares severity glyphs
- Plan 30 — gate ribbon integrates sticky banners
