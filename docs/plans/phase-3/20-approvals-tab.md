# Plan 20 — Approvals tab

**Phase**: 3 · **Depends on**: Plans 12, 13, 18, 19 · **Blocks**: Phase 3 exit · **Est**: 1.5 days

## Goal

Make every tool-call approval first-class: pending list with risk badges, one-click approve/reject, inspector drawer for args preview + evidence, multi-client lock. This is the feature that makes users trust the system.

## Why this is hard

Approval UX is the friction surface between "agent got blocked because safety" and "user got annoyed by too many prompts." Getting the defaults right (auto-approve patterns, batch approve, trust-builder) is iterative. Plus multi-client races must resolve cleanly — never double-approve.

## Scope

### In
- Pending approval list with filters + sort.
- Risk badges per `ux-grammar.md` severity grammar.
- Keyboard shortcuts: `a`, `A` (all), `x`.
- `approval_inspector` overlay for deep inspect.
- Multi-client lock with optimistic UI + rollback.
- Batch approve for related calls.

### Out
- Trust-builder mode / auto-approve rules (post-v1).
- Cross-session approval (not a thing).

## Deliverables

```
apps/web/src/
├── stores/approvals.ts
├── domain/approvals/
│   ├── hooks.ts
│   ├── handlers.ts
│   └── risk.ts
├── components/
│   └── Workbench/Approvals/
│       ├── ApprovalsTab.tsx
│       ├── PendingList.tsx
│       ├── ApprovalRow.tsx
│       ├── RiskBadge.tsx
│       ├── Inspector.tsx       # overlay: kind=approval_inspector
│       └── BatchBar.tsx
```

## Stages

### S1 — Store (0.2 day)

```ts
interface ApprovalsSlice {
  pending: Map<ApprovalId, Approval>;
  order: ApprovalId[];       // arrival order
  filter: { severity?: Severity; subsystem?: string };
  selectedIds: Set<ApprovalId>;
  activeInspectorId: ApprovalId | null;
  onPending(a: Approval): void;
  onResolved(id: ApprovalId, decision: 'approved'|'rejected', byClientId?: ClientId): void;
  onExpired(id: ApprovalId): void;
  select(id: ApprovalId): void;
  clearSelection(): void;
  optimisticResolve(id: ApprovalId, decision: 'approved'|'rejected'): void;
  rollback(id: ApprovalId, reason: string): void;
}
```

**Exit**: store reducers tested; rollback restores prior state.

### S2 — Event handlers (0.1 day)

```ts
queue.on('approval.pending', (ev) => store.onPending(ev.payload));
queue.on('approval.resolved', (ev) => store.onResolved(ev.payload.approvalId, ev.payload.decision, ev.payload.byClientId));
queue.on('approval.expired', (ev) => store.onExpired(ev.payload.approvalId));
```

**Exit**: pending → list updates; resolved → entry moves to history (or removes).

### S3 — `<ApprovalsTab/>` skeleton (0.2 day)

Outer tab in Workbench:
```tsx
function ApprovalsTab() {
  const pending = useApprovals(s => s.pending, shallow);
  const order = useApprovals(s => s.order, shallow);
  const selected = useApprovals(s => s.selectedIds, shallow);
  return (
    <section className="approvals-tab">
      <FilterBar />
      <PendingList order={order} pending={pending} />
      {selected.size > 0 && <BatchBar />}
    </section>
  );
}
```

Badge shown on Workbench tab label when `pending.size > 0`.

**Exit**: tab shows rows; count badge accurate.

### S4 — `<ApprovalRow/>` + RiskBadge (0.2 day)

```tsx
function ApprovalRow({ id }) {
  const a = useApprovals(s => s.pending.get(id));
  if (!a) return null;
  return (
    <div className="approval-row" data-severity={a.risk}>
      <Checkbox checked={...} onChange={...} />
      <RiskBadge risk={a.risk} />
      <div className="meta">
        <strong>{a.toolCall.tool}</strong>
        <p className="args-preview">{previewArgs(a.toolCall.args)}</p>
        <small>{a.subsystem} · {timeAgo(a.createdAt)}</small>
      </div>
      <div className="actions">
        <button onClick={() => inspect(id)}>Inspect</button>
        <button onClick={() => approve(id)}>Approve (a)</button>
        <button onClick={() => reject(id)}>Reject (x)</button>
      </div>
    </div>
  );
}
```

Risk levels from bridge: `green` (local/verified), `info`, `warn` (sensitive), `error` (destructive).
RiskBadge uses `SeverityIcon` + text.

`previewArgs`: first 120 chars; full in Inspector.

**Exit**: row renders; click Approve → optimistic removal.

### S5 — Inspector overlay (0.3 day)

Overlay kind `approval_inspector`. Shows:
- Full args (JSON viewer with collapse).
- Call site (tool + agent).
- Risk rationale (from VAC's trust system).
- Any attached evidence (for assessor-initiated calls, not common in code flow).
- Related audit entries (if any).
- Approve + Reject buttons (same as row).

Opens via "Inspect" button or `Enter` with row focused.

**Exit**: opens with all fields populated; keyboard nav inside works.

### S6 — Keyboard hotkeys (0.1 day)

When Approvals tab is active:
- `a`: approve focused row.
- `A` (shift+a): approve all visible.
- `x`: reject focused row.
- `j/k`: move focus (matches TUI).
- `Enter`: open Inspector for focused row.

Implementation: scoped keybinding context via `react-hotkeys-hook` scoped to tab mount.

**Exit**: keyboard-only approval flow works.

### S7 — Multi-client lock + optimistic UI (0.2 day)

Flow:
1. User clicks Approve → `optimisticResolve` marks row as "resolving".
2. Send `approval.approve { approvalId }`.
3. Two possible outcomes:
   - Ack ok → row removed from pending.
   - Ack ok BUT `approval.resolved` event received with `byClientId !== myClientId` → same as ok (another client won; either way resolved).
   - Ack error (e.g., `approval.already_resolved` with different decision) → rollback + toast "another user decided first: rejected".

**Exit**: two-tab test: both approve same item; only one sees confirmation, other sees "already resolved by user X".

### S8 — Batch approve (0.1 day)

When `selectedIds.size > 0`:
- Show BatchBar bottom: "Approve N · Reject N · Clear".
- Approve all: iterate selected, send approvals in parallel; update progress bar.
- If any fail → list failures with reasons.

**Exit**: batch approve 10 items; confirmation shown; partial failures listed.

### S9 — Edge cases (0.1 day)

- Approval expires while user is looking: UI shows "expired" + option to retry (sends `approval.inspect` to see if new one available).
- Pending list empty: show empty state with explanation.
- Filter by severity + subsystem: filter bar active.

**Exit**: edge states render cleanly.

## Testing

- Unit: store reducers (especially optimistic + rollback).
- E2E: approve flow, reject flow, multi-tab race.
- Keyboard-only flow.

## Exit criteria

- [ ] Approve/reject E2E works.
- [ ] Multi-client race resolves without double-apply.
- [ ] Keyboard hotkeys cover all actions.
- [ ] Inspector populated.
- [ ] Badge in tab label accurate.

## Risks

| Risk | Mitigation |
|---|---|
| Optimistic UI flash on fast ack | Delay removal 100ms to avoid jitter |
| Users approving without reading args | Inspector mandatory for risk=error (can't approve from row; row's approve button opens inspector first) |
| Batch approve unsafe | Batch excluded for risk=error items; user must inspect each |

## Related

- [`ux-grammar.md`](../../ux-grammar.md) §2 — risk colors
- Plan 18 — notify (approval emits persistent entry)
- Plan 19 — overlays (Inspector)
