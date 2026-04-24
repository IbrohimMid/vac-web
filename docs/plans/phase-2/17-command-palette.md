# Plan 17 — Command palette + ActionSpec

**Phase**: 2 · **Depends on**: Plan 12, 13 · **Blocks**: Phase 2 exit · **Est**: 1 day

## Goal

Implement the universal `⌘K`/`Ctrl+K` command palette populated from `ActionSpec[]` emitted by the bridge. Profile-aware: denied actions show greyed with tooltip; `availableWhen` filters dynamically.

## Why this is hard

ActionSpec is the shared action registry — the same list that drives keybindings, slash commands, and the palette. Drift between them = broken keyboard UX. Also: `availableWhen` is a tiny expression language (session state predicates); must be safe + fast.

## Scope

### In
- `ActionSpec[]` fetch at session init.
- `<CommandPalette/>` overlay with fuzzy filter.
- Group display + recency weighting.
- Profile-aware disabling.
- `availableWhen` predicate interpreter (safe subset).
- `palette.invoke_action` dispatch.
- Slash alias in Composer (`/rtd` etc.) reuses same ActionSpec.

### Out
- Action-specific UIs (each epic owns its action's modal/flow).
- Keybinding customization (post-v1).

## Deliverables

```
apps/web/src/
├── actions/
│   ├── registry.ts            # ActionSpec registry + hooks
│   ├── predicate.ts           # availableWhen interpreter
│   ├── recency.ts             # usage tracker + weighting
│   └── slash.ts               # composer slash lookup
├── components/
│   └── CommandPalette/
│       ├── CommandPalette.tsx
│       ├── PaletteRow.tsx
│       ├── GroupHeader.tsx
│       └── FuzzyFilter.ts
```

## Stages

### S1 — Fetch + store ActionSpec (0.2 day)

On `session.ready`, bridge emits `system.capabilities` event including actions:
```json
{ "type": "system.capabilities",
  "payload": {
    "actions": [
      { "id":"message.cancel", "label":"Cancel stream", "group":"Session", "keybinding":"Escape", "paletteVisible":true, ... },
      ...
    ]
  }
}
```

Stored in `actions/registry.ts` Zustand slice. Immutable for session duration.

**Exit**: registry populated on session attach; devtools shows actions.

### S2 — Predicate interpreter (0.2 day)

`availableWhen` is a small expression language, documented:
```
session.open
session.streaming
workbench.tab == "approvals"
approvals.pendingCount > 0
!session.streaming && session.open
```

Interpreter: hand-rolled pratt-parser for comparison + boolean ops + member access. **No arbitrary JS eval**. Allowed tokens: identifiers, literals (string, number, boolean), `&&`, `||`, `!`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `.`.

Context object:
```ts
interface PredicateContext {
  session: { open: boolean; streaming: boolean; hasChangeset: boolean; ... };
  workbench: { tab: string };
  approvals: { pendingCount: number };
  gates: Record<string, 'green'|'yellow'|'red'|'overridden'>;
  ...
}
```

Parse at registry load; re-evaluate on context change.

**Exit**: invalid expressions rejected at load (with error logged); valid expressions evaluate correctly under context changes.

### S3 — `<CommandPalette/>` overlay (0.2 day)

```tsx
function CommandPalette() {
  const isOpen = useOverlays(s => s.isOpen('command_palette'));
  const [query, setQuery] = useState('');
  const actions = useFilteredActions(query);
  // ... Ctrl+K binds to overlays.open('command_palette')
  return (
    <Dialog open={isOpen} onClose={() => overlays.dismiss('command_palette')}>
      <Input autoFocus value={query} onChange={...} placeholder="Type a command…" />
      <List>{actions.map(a => <PaletteRow key={a.id} action={a} onInvoke={invoke} />)}</List>
    </Dialog>
  );
}
```

Keyboard: `↑/↓` navigate, `Enter` invoke, `Esc` close. Focus returns to previous element on close (see Plan 19 OverlayManager).

**Exit**: palette opens, closes, navigates; ESC works.

### S4 — Fuzzy filter + grouping + recency (0.2 day)

Filter:
- Library: `fuse.js` or hand-rolled small fuzzy matcher (label + id matched).
- Score includes recency bonus: actions used in last 5 min boost by 30%, last hour by 10%.

Grouping:
- Actions grouped by `ActionSpec.group` (e.g., Build, Assess, Handoff, Release, Session, System).
- Groups displayed in order defined by a static priority list.
- Within group: score descending.

Disabled actions (profile-denied or `availableWhen=false`) shown grey with tooltip reason at bottom of group.

**Exit**: type "rtd" → Ready-to-Deploy bubbles to top.

### S5 — Recency persistence (0.1 day)

Store last-used timestamps in localStorage:
```ts
{ "assessment.run_rtd": 1714000000000, ... }
```

Trimmed to last 100 distinct actions.

**Exit**: re-open app → recency preserved.

### S6 — Invocation (0.2 day)

```ts
async function invoke(action: ActionSpec, args?: any) {
  // Check profile-denied → show reason + abort.
  if (action.deniedByProfile) { notify(...); return; }
  // Dispatch.
  const ack = await transport.send(sessionId, 'palette.invoke_action', { actionId: action.id, args });
  if (!ack.ok) notify.error(ack.error);
  // Update recency.
  recency.markUsed(action.id);
}
```

Some actions have side-UI (e.g., file picker before dispatch). Registry entry can declare `prepareUi: 'file_picker' | 'form_modal' | null`; palette opens that first, then dispatches with its result.

**Exit**: invoke `/help` → get help response; invoke `/rtd` → starts assessment run.

### S7 — Slash alias (0.1 day)

In Composer: when user types `/` as first char, open palette-like popup filtered by `slashAlias`:
- Type `/rtd` → matches action with `slashAlias: "/rtd"`.
- Enter → invoke + clear composer.
- Unmatched `/foo` → send as regular message.

**Exit**: `/rtd` behaves identically to palette invoke.

### S8 — Profile integration (0.1 day)

ActionSpec carries `requiredCapabilities: ["assessment.run","connector.read.github"]`. Client checks against pinned profile's tool_allow (from session context). Denied → greyed with tooltip "denied by profile <id>: missing capability `X`".

**Exit**: in assessor-only session, `/deploy` action greyed; invocation blocked.

## Testing

- Predicate parser: positive + negative fixtures.
- Keyboard navigation E2E.
- Recency persistence.
- Disabled-action UX.

## Exit criteria

- [ ] Open palette, fuzzy search, invoke action.
- [ ] Slash alias works.
- [ ] Disabled actions visibly disabled with reason.
- [ ] Recency survives reload.
- [ ] All actions testable via palette only (keyboard-first).

## Risks

| Risk | Mitigation |
|---|---|
| Predicate expression footgun | No `eval`; grammar tested; small surface |
| Actions drift from bridge | Registry is single source from server; client never defines actions |
| Fuzzy filter slow with 500+ actions | Pre-index labels; measure |
| Slash alias collides with real slash-prefixed text | Heuristic: `/foo[a-z]+` with space or enter unambiguous |

## Related

- [`ux-grammar.md`](../../ux-grammar.md) §8 — ActionSpec schema
- Plan 19 — overlays (hosts palette)
- Plan 10 — profile enforcement (backend)
