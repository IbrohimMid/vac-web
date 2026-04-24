# Plan 33 — Handoff builder UI + two-party approval

**Phase**: 5 · **Depends on**: Plans 29, 30, 32 · **Blocks**: 34 · **Est**: 2 days

## Goal

UI for authoring `HandoffPacket`: pick findings → author tasks → review pin → submit for approval. Two-party approval flow with role confirmation + reason. Clear invalidation UX.

## Why this is hard

Handoff is the user-facing "handover" moment. If it feels bureaucratic, people bypass. If it feels trivial, people rubber-stamp. The UI must make the packet's consequences visible (what executor will do, what pin constraints hold, what invalidation triggers) without overwhelming.

## Scope

### In
- `handoff_builder` overlay with multi-step wizard.
- Task editor (reorder, edit rationale, constraints).
- Pin preview.
- Target selector (profile picker).
- Approval dialog (single + two-party paths).
- Rejection flow.
- Invalidation + expiry UI.
- Handoff list tab under Workbench (or top-level nav).

### Out
- Dispatch logic (Plan 34).
- Reassess UI (Plan 35).

## Deliverables

```
apps/web/src/
├── components/
│   ├── Workbench/Handoff/
│   │   ├── HandoffTab.tsx
│   │   ├── HandoffList.tsx
│   │   ├── HandoffRow.tsx
│   │   └── HandoffDetail.tsx
│   ├── HandoffBuilder/
│   │   ├── HandoffBuilder.tsx      # overlay kind=handoff_builder (multi-step)
│   │   ├── StepFindings.tsx
│   │   ├── StepTasks.tsx
│   │   ├── StepPin.tsx
│   │   ├── StepTarget.tsx
│   │   ├── StepReview.tsx
│   │   ├── TaskEditor.tsx
│   │   └── PinPreview.tsx
│   └── HandoffApproval/
│       ├── ApprovalDialog.tsx
│       ├── TwoPartyBanner.tsx
│       ├── ApproverRoster.tsx
│       └── InvalidationNotice.tsx
├── stores/handoff.ts
```

## Stages

### S1 — Store (0.2 day)

```ts
interface HandoffSlice {
  packets: Map<HandoffId, HandoffPacket>;
  active: HandoffId | null;
  builderDraft: HandoffDraft | null;   // in-progress draft
  buildFromFindings(findingIds: FindingId[]): HandoffDraft;
  updateDraft(patch: Partial<HandoffDraft>): void;
  commitDraft(): Promise<HandoffId>;
  approve(id: HandoffId, note?: string): Promise<void>;
  reject(id: HandoffId, reason: string): Promise<void>;
  cancel(id: HandoffId, reason: string): Promise<void>;
}
```

Handlers: all lifecycle events from Plan 32 wired.

**Exit**: reducers tested.

### S2 — HandoffTab + list (0.2 day)

Top-level sidebar entry (Handoff) with sub-sections:
- Drafts.
- Pending approval (shown prominently; badge count).
- Approved.
- Dispatched / executing.
- History (completed/rejected/invalidated/expired).

List virtualized if > 50 entries.

**Exit**: list renders across sections; row click opens detail.

### S3 — Builder wizard (0.5 day)

Overlay `handoff_builder` is a 5-step wizard:

**Step 1 — Findings**: pre-selected from Plan 29's "Create handoff" entry point, editable here. Each shows severity + evidence chip; click to remove.

**Step 2 — Tasks**: auto-generated from findings' `suggested_fix`, editable. TaskEditor:
- Title, rationale (markdown).
- Steps (multi-line list).
- Constraints (add/remove).
- Risk notes.
- Est effort picker.
- Depends on (dropdown of sibling tasks).
- Touches paths (file picker; narrows executor fs scope).

**Step 3 — Pin**: read-only preview of what will be captured. Shows:
- Base commit SHA (shortened).
- Worktree digest computation progress + result.
- Connector snapshots (kind + captured-at).
- Expires at (picker, capped by policy).
- Invalidation policy (strict/lenient radio with tooltip).

**Step 4 — Target**: explicit profile picker.
- Visible profiles depend on accepted findings' scope:
  - Code edits → `executor.code`.
  - Release work → `executor.release`.
- Cross-domain → prompts user to split into chained handoffs.

**Step 5 — Review**: final JSON-ish summary. Submit button disabled until all fields valid.

Step nav + back/next buttons; URL hash updates so user can deep-link to a step.

**Exit**: complete builder flow produces a valid packet.

### S4 — Submit + rejection paths (0.2 day)

On submit:
- Validates draft client-side.
- Calls `handoff.create`; receives `HandoffId`.
- Transitions to packet detail view.

On rejection (from approver): reason modal required; calls `handoff.reject`.

**Exit**: packet appears in "Pending approval" post-submit.

### S5 — ApprovalDialog (0.3 day)

Overlay. Shows packet summary + pin status + target profile + approver identity/role.

Single-party:
- "Approve" button requires note (optional for low-risk packets, mandatory for creator-approver same user).

Two-party:
- TwoPartyBanner at top explains requirement.
- If no prior signoff: your action = "First approval" (role confirm).
- If one prior: shows first approver + role; your action = "Second approval (must be different role)".
- Same-user-different-role refused at bridge.

Calls `handoff.approve { note? }`.

**Exit**: both flows tested; same-user double attempt rejected.

### S6 — Invalidation notice (0.2 day)

If pin verify fails at approval time (server emits `handoff.invalidated`):
- ApprovalDialog swaps to InvalidationNotice.
- Shows reason (drift / expiry / snapshot stale).
- CTAs:
  - "Refresh assessment" → runs `assessment.replay` on sourceRunIds.
  - "Create new handoff from refreshed runs" → pre-populated builder.
  - "Archive this packet".

**Exit**: drift → clear user path forward.

### S7 — HandoffDetail (0.2 day)

Detail page: packet metadata, pin, tasks list (collapsed by default), evidence refs, state history, audit trail link.

Actions depending on state:
- Draft: Edit, Submit.
- Pending approval: Approve (if role qualifies), Reject.
- Approved: Dispatch (Plan 34), Cancel.
- Dispatched/Executing: View executor session (link).
- Terminal: View outcome.

**Exit**: all states have appropriate actions.

### S8 — Audit trail UI (0.1 day)

Subpage or modal per packet showing full append-only log: each transition with timestamp, actor, reason, pin digest.

**Exit**: audit trail readable; copy-friendly.

### S9 — Event handlers & realtime (0.1 day)

Subscribe to all `handoff.*` events; update store. Multi-client: another user approving → UI reflects immediately.

**Exit**: two-tab test: approve in tab A → tab B shows approved state.

### S10 — A11y + edge polish (0.1 day)

- Wizard keyboard nav.
- Approval dialog: Tab / Shift+Tab cycles.
- Disabled-state reasoning via tooltip.
- Mobile layout: wizard becomes full-screen steps.

**Exit**: axe-core passes.

## Testing

- Unit: draft reducers + validation.
- E2E: build + submit + approve.
- Multi-client: approval sync.
- Invalidation path.

## Exit criteria

- [ ] Complete flow: findings → builder → submit → approve → approved state.
- [ ] Two-party works with same-user refusal.
- [ ] Invalidation UX clear.
- [ ] All states accessible.

## Risks

| Risk | Mitigation |
|---|---|
| Builder feels heavy | Smart defaults; auto-fill from suggested_fix; skip wizard steps when user declines customization |
| Users bypass approval meaning | Micro-copy + audit visibility; approval dialog can't be closed without explicit choice |
| Multi-client approval race | Bridge single-writer lock; client gracefully handles "already approved by X" |

## Related

- [`handoff-contract.md`](../../handoff-contract.md)
- Plan 29 — selection source
- Plan 32 — backend lifecycle
- Plan 34 — dispatch on approved
