# Plan 19 — Overlay manager

**Phase**: 2 · **Depends on**: Plan 13, 17 · **Blocks**: Phase 2 exit, many later tabs · **Est**: 1 day

## Goal

Implement the semantic overlay stack that mirrors the TUI's overlay manager: max depth 2, Esc precedence, focus restore, multi-client sync. Every modal, dialog, drawer, picker goes through this manager.

## Why this is hard

Browser-native dialogs + React-managed overlays + keyboard-trap + focus restore + multi-client sync don't naturally cooperate. Getting this right early avoids per-component reimplementation of focus traps and Esc handling.

## Scope

### In
- `OverlayManager` Zustand slice.
- `<OverlayHost/>` portal renderer.
- `OverlayKind` semantic enum (from `ux-grammar.md §5`).
- Focus restore on dismiss.
- Esc precedence (innermost first).
- Max depth 2.
- Multi-client sync via `overlay.opened` / `overlay.dismissed` events.
- Responsive: modal ↔ split-pane per viewport.

### Out
- Actual overlay content for each kind (each epic owns its modal).

## Deliverables

```
apps/web/src/
├── overlays/
│   ├── registry.ts           # kind → component mapping
│   ├── store.ts              # OverlayManager slice
│   ├── focus.ts              # save/restore focus
│   ├── esc.ts                # global Esc handler
│   └── sync.ts               # multi-client event handlers
├── components/
│   └── OverlayHost/
│       ├── OverlayHost.tsx
│       └── OverlayBackdrop.tsx
```

## Stages

### S1 — Store (0.2 day)

```ts
interface Overlay {
  id: OverlayId;            // ulid
  kind: OverlayKind;        // semantic
  params?: unknown;
  openedAt: number;
  originFocus?: string;     // CSS selector / element id to refocus on dismiss
  originClientId?: ClientId; // null for local, set for remote client
}
interface OverlaysSlice {
  stack: Overlay[];         // top of stack = top of z
  open(kind: OverlayKind, params?: any): OverlayId;
  dismiss(id: OverlayId): void;
  dismissAll(): void;
  topmost(): Overlay | undefined;
  isOpen(kind: OverlayKind): boolean;
}
```

Open: push; if stack length > 2, remove bottom first (emit dismissed for it).
Dismiss: remove by id; restore focus to its `originFocus`.

**Exit**: reducers tested; depth cap enforced.

### S2 — Kind registry (0.2 day)

```ts
export type OverlayKind =
  | 'command_palette'
  | 'file_search'
  | 'model_switcher'
  | 'profile_switcher'
  | 'shell_drawer'
  | 'approval_inspector'
  | 'diff_viewer'
  | 'handoff_builder'
  | 'gate_detail'
  | 'assessment_report'
  | 'connector_manager'
  | 'override_dialog'
  | 'signoff_dialog'
  | 'confirm'
  | 'ask_user'
  | 'share_session'
  | ...;

export const overlayComponents: Record<OverlayKind, LazyExoticComponent<...>> = {
  command_palette: lazy(() => import('../components/CommandPalette')),
  file_search: lazy(() => import('../components/FileSearch')),
  ...
};
```

Lazy imports: overlay chunks loaded on first open.

**Exit**: all kinds declared; first open triggers code split.

### S3 — `<OverlayHost/>` (0.2 day)

```tsx
function OverlayHost() {
  const stack = useOverlays(s => s.stack, shallow);
  return (
    <>
      {stack.map((ov, idx) => {
        const Component = overlayComponents[ov.kind];
        return createPortal(
          <div className="overlay" style={{zIndex: 100 + idx}}>
            <OverlayBackdrop onClick={() => dismiss(ov.id)} />
            <Suspense fallback={<OverlaySpinner />}>
              <Component id={ov.id} params={ov.params} />
            </Suspense>
          </div>,
          document.body
        );
      })}
    </>
  );
}
```

Backdrop click dismisses topmost only. Inner overlays don't auto-close peers.

Body scroll lock when stack non-empty.

**Exit**: open palette → backdrop visible → click outside dismisses.

### S4 — Focus management (0.2 day)

On open:
- Save `document.activeElement` (by id/tagName path).
- After mount, focus first focusable element inside overlay (handled by each overlay component via `autoFocus`).
- Trap focus: `Tab` cycles within overlay; shift-Tab reverse.

On dismiss:
- Restore focus to saved element; if not present (removed from DOM), focus `main` role element.

Library: `focus-trap-react` or hand-rolled (~50 lines).

**Exit**: keyboard-only user can't escape overlay until dismissed; after dismiss, focus restored.

### S5 — Esc precedence (0.1 day)

Global listener:
```ts
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const topmost = useOverlays.getState().topmost();
  if (topmost) {
    e.preventDefault();
    useOverlays.getState().dismiss(topmost.id);
    return;
  }
  // No overlay → clear transcript focus or noop
});
```

Attached once at app init. Handlers in overlay components may `preventDefault()` to own Esc (e.g., composer clearing input first); design rule: only root composer does this, overlays defer.

**Exit**: nested overlays: Esc dismisses inner; second Esc dismisses outer.

### S6 — Multi-client sync (0.2 day)

On local open: also emit `overlay.open` command to bridge (for state broadcast).
On remote event `overlay.opened` (from another client): add to local stack (with `originClientId` set) so UI mirrors.
On local dismiss: emit `overlay.dismiss`.
On remote `overlay.dismissed`: remove from local stack.

**Gotcha**: not all overlays should sync (e.g., file_search is per-client UI). `OverlayKind` has `syncable: true | false` flag in registry.

**Exit**: two browser tabs: open gate_detail from tab A → tab B shows it.

### S7 — Responsive behaviour (0.1 day)

Some overlays prefer split-pane on wide viewports:
- `diff_viewer`: `viewport < 1280px` → modal; else split-pane.
- `assessment_report`: same.
- `shell_drawer`: always drawer (bottom dock on wide, full modal on narrow).

Overlay component reads viewport via media query; chooses render mode. `OverlayHost` treats them uniformly (still in stack).

**Exit**: resize test: overlay transitions cleanly.

## Testing

- Unit: store reducers.
- Integration: focus trap + restore.
- E2E: multi-overlay Esc precedence.
- Multi-client: open overlay in tab A → tab B reflects (when syncable).

## Exit criteria

- [ ] Max depth 2 enforced.
- [ ] Esc dismisses innermost.
- [ ] Focus restored correctly.
- [ ] Lazy chunks load on first open.
- [ ] Syncable overlays mirror across clients.

## Risks

| Risk | Mitigation |
|---|---|
| Focus trap library conflicts with React concurrent | Test with concurrent mode; switch to hand-rolled if needed |
| Backdrop clicks swallow intended content clicks | Use exact `e.target === backdrop` check |
| Portal + SSR issues | No SSR in v1 (client-only); future: `useEffect` to mount portal |
| Over-syncing between clients | `syncable` flag gates; per-client UI stays local |

## Related

- [`ux-grammar.md`](../../ux-grammar.md) §5 — overlay semantics
- Plan 17 — palette is an overlay
- Plan 23 — shell drawer is an overlay
- Plan 33 — approvals inspector is an overlay
