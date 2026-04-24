# Handoff Contract

**Status**: v1 (locked for Phase 0.5)
**Scope**: `HandoffPacket` data model, pin semantics, invalidation policy, lifecycle, dispatch flow, and executor session binding.

---

## 1. Principles

1. **Handoff is the sole bridge** between assessor findings and executor mutation. No shortcuts.
2. **Every packet is pinned** to an immutable snapshot of assessment-time state.
3. **Every packet names exactly one executor profile.** Cross-profile work → chained handoffs.
4. **Approval is explicit, auditable, time-bound.**
5. **Execution never expands packet scope.** Executor session is restricted to packet tasks.

---

## 2. HandoffPacket

### Schema

```jsonc
{
  "id":      "handoff_<ulid>",
  "title":   "one-liner",
  "summary": "markdown, ≤ 1000 chars",

  "sourceRunIds":         ["run_..."],    // ≥ 1 AssessmentRun ids
  "acceptedFindingIds":   ["fnd_..."],    // subset of findings user chose
  "createdBy":            "usr_...",
  "createdAt":            "ISO8601",

  "pin": {
    "repoRef":               "branch/tag/sha string",
    "baseCommitSha":         "<sha>",
    "worktreeDigest":        "sha256:<hash of tracked files at capture time>",
    "assessmentSnapshotAt":  "ISO8601",
    "connectorSnapshots": [
      { "connectorId": "...", "kind": "github", "snapshotId": "...", "capturedAt": "..." }
    ],
    "expiresAt":             "ISO8601",
    "invalidateOnRepoChange": true,
    "invalidationPolicy":    "strict | lenient"
  },

  "tasks": [
    {
      "id":           "task_<ulid>",
      "title":        "short imperative",
      "rationale":    "markdown — why this task",
      "evidenceRefs": [ { ...EvidenceRef } ],
      "steps":        ["...", "..."],
      "constraints": [
        "do not touch src/legacy/*",
        "keep migration reversible"
      ],
      "riskNotes":    ["may trigger full test suite (~20m)"],
      "estEffort":    "hours | days | weeks",
      "dependsOn":    ["task_..."],
      "touchesPaths": ["src/auth/**"],        // declared fs scope for this task
      "requiresApprovalPerStep": false        // true → every step needs approval
    }
  ],

  "orderHint":  ["task_a", "task_b"],        // suggested execution order
  "target": {
    "kind":              "dispatch_to_local_vac | dispatch_to_vac_web_cli | export_as_blueprint_only",
    "executorProfileId": "executor.code@1.0.0 | executor.release@1.0.0",
    "sessionTitle":      "string?"
  },

  "approval": {
    "required":       true,
    "approvers":      ["usr_..."],           // list of approvers who signed
    "approverNotes":  "markdown?",
    "approvedAt":     "ISO8601?",
    "twoParty":       false,                 // true → needs 2 approvers from different roles
    "requiredRoles":  ["release_manager"]    // set when twoParty or target is release
  },

  "state": "draft | pending_approval | approved | dispatched | executing | completed | rejected | cancelled | invalidated | expired",

  "stateHistory": [
    { "state": "...", "at": "ISO8601", "by": "usr_...", "reason": "string?" }
  ],

  "executionSessionId": "sess_...?",          // set on dispatch
  "executionOutcome": {                        // set on completion
    "status":            "success | partial | failed | cancelled",
    "tasksCompleted":    ["task_..."],
    "tasksFailed":       ["task_..."],
    "changesetSummary":  "n files changed",
    "reassessmentRunId": "run_...?"
  }
}
```

### Constraints (serializer-enforced)

- `sourceRunIds.length >= 1`.
- `acceptedFindingIds.length >= 1`; each must belong to one of `sourceRunIds`.
- `pin.baseCommitSha` resolves in repo at serialization time.
- `pin.expiresAt > now() + 1h` minimum; `≤ now() + 7d` default; `≤ 30d` hard cap.
- `target.executorProfileId` exists in profile catalog.
- If `target.kind = dispatch_*`: at least one task must exist.
- If any accepted finding has severity `critical`: `target.approval.twoParty = true` auto-set.
- If `target.executorProfileId` class is `release`: `twoParty = true`, `requiredRoles` includes `release_manager`.

---

## 3. Pin semantics

### What pin captures

- `repoRef` — human-readable ref name.
- `baseCommitSha` — immutable commit hash; executor starts from this.
- `worktreeDigest` — hash of all tracked files' contents at assessment time.
  - Computed as `sha256(sorted_join(path + ":" + sha256(content)))` over tracked files.
  - Excludes files in `.gitignore`.
- `connectorSnapshots` — IDs referencing cached connector responses (see `evidence-freshness.md`).
- `assessmentSnapshotAt` — timestamp of the assessment that produced source findings.
- `expiresAt` — after this, packet cannot be dispatched without reassess.

### Why pin

1. **Correctness**: assessor evaluated state A; executor must act against state A (or a defined superset).
2. **Reproducibility**: pin provides enough info to recreate assessment context.
3. **Safety**: drift detection prevents "fix applied to stale understanding of code."

### Storage
Packets at `~/.local/share/vac-web/handoffs/<handoff_id>.json`. Retained 180 days. User may pin indefinitely.

---

## 4. Invalidation policy

### `strict` (default for critical severity + release profile)

Packet invalidated if **any** of:
- `baseCommitSha` no longer reachable (branch deleted, history rewritten).
- Worktree digest changed (any tracked file modified).
- Any `connectorSnapshots[].kind = hard_expire` source is stale.
- `expiresAt` passed.

### `lenient`

Packet invalidated if:
- `baseCommitSha` no longer reachable, OR
- Files under `tasks[].touchesPaths` changed (i.e., scope-relevant drift only), OR
- `expiresAt` passed.

Files outside `touchesPaths` can drift without invalidating. Useful for long-running packets where unrelated work happens in parallel.

### Detection

Bridge verifies pin at two checkpoints:
1. **At approval**: `handoff.approve` recomputes digest; drift → reject approval, emit `handoff.invalidated`.
2. **At dispatch**: `handoff.dispatch_local` recomputes again; drift → emit `handoff.invalidated { reason }`, state → `invalidated`.

User's recourse on invalidation:
- Re-run assessment (`assessment.replay`).
- Create new handoff from fresh run.
- If drift is minor and lenient policy appropriate: `handoff.create { copyFrom, invalidationPolicy: lenient }` — explicit action, not automatic.

---

## 5. Lifecycle state machine

```
  draft ───────── handoff.create
   │
   │   handoff.edit (title, tasks, order, target)
   │ ◄─────────┐
   │           │
   ▼           │
  pending_approval ── handoff.reject ──► rejected (terminal)
   │
   │ handoff.approve (maybe twoParty)
   ▼
  approved ── handoff.invalidated ──► invalidated (terminal)
   │       ── handoff.expired ──────► expired (terminal)
   │
   │ handoff.dispatch_local | dispatch_web_cli
   ▼
  dispatched ── handoff.cancel ──► cancelled (terminal)
   │
   ▼
  executing ── pin drift mid-exec ──► invalidated (terminal)
   │
   ▼
  completed (terminal)
```

Terminal states: `rejected`, `invalidated`, `expired`, `cancelled`, `completed`.

Every transition: logged in `stateHistory` + emitted as event.

---

## 6. Dispatch flow

### `handoff.dispatch_local`

1. Verify state = `approved`.
2. Re-verify pin (digest + expiry + connectors).
3. Spawn new session:
   - `class = executor`, `profileId = target.executorProfileId`.
   - Initial context = packet tasks + evidence refs (read-only view).
   - Working tree checked out at `pin.baseCommitSha` in a fresh branch (`handoff/<handoff_id>`).
4. Bridge forwards tasks to agent as a structured initial prompt.
5. Agent executes tasks respecting `constraints`, `touchesPaths`, `requiresApprovalPerStep`.
6. Every mutation still passes through per-tool approval flow.
7. On each task completion → `handoff.execution_progress { taskId, status }`.
8. On all tasks complete or unrecoverable failure → `handoff.completed { outcome }`.
9. Trigger auto-reassess: `assessment.replay` on each `sourceRunId` in parallel.

### `handoff.dispatch_web_cli`
Phase 7 hosted mode. Same flow, executor session runs on paired remote CLI.

### `handoff.export_blueprint`
Produces markdown/JSON blueprint with tasks + rationale + evidence. No execution. For external tools or human handoff.

---

## 7. Executor session binding

When spawned via dispatch:

- `executionSessionId` captured in packet.
- Session pinned to profile named in `target.executorProfileId`.
- Session's `fs.scoped_paths` (when profile is `executor.release`) = packet's aggregated `tasks[].touchesPaths` ∪ profile default.
- Session tagged with `handoff_id` in audit log.
- Session close → packet state → `completed` (if all tasks done) or `cancelled`.

The executor session **cannot outlive the packet**. Packet cancellation → session termination.

---

## 8. Approval mechanics

### Single-party (default)
- User clicks Approve → confirmation dialog (reason field required if approver role ≠ creator role).
- `handoff.approve { handoffId, approverNote? }`.

### Two-party
Required when:
- Any accepted finding severity = `critical`, OR
- `target.executorProfileId` class = `release`, OR
- Packet `approval.twoParty = true` explicitly set.

Mechanics:
- First approver: `handoff.approve { ... }` → state → `pending_approval` with one signature.
- Second approver MUST have a different `role` than first.
- Second approval → state → `approved`.
- Second approver CAN add `approverNotes` overriding first.
- UI displays both approvers + timestamps + roles.

### Reject
- `handoff.reject { reason }` (min 10 chars) → state → `rejected`.
- Findings remain accepted in source run for later re-handoff; packet is dead.

---

## 9. Audit & forensics

Every lifecycle transition logged to audit:
```jsonc
{
  "ts": "ISO8601",
  "handoffId": "...",
  "transition": "draft → pending_approval",
  "by": "usr_...",
  "reason": "string?",
  "pinDigest": "sha256:...",
  "profileId": "executor.code@1.0.0"
}
```

`~/.config/vac-web/audit/handoffs/<handoff_id>.jsonl`.

UI: `Handoff → <packet> → Audit trail` surfaces full history including all approvals, rejections, invalidations, dispatch attempts, execution progress.

---

## 10. Cross-profile chaining

When a goal requires both code edits and release work:

1. Create packet A, target `executor.code@1.0.0`, tasks: edit source.
2. Approve + dispatch A → executor fixes code.
3. Auto-reassess → new findings (or same, now resolved).
4. Create packet B from reassessed run, target `executor.release@1.0.0`, tasks: tag + deploy.
5. Approve B (two-party) + dispatch.

Bridge surfaces this via UI: packet completion offers "Create release handoff from these results."

Chained packets are linked via `chainedFromHandoffId` field (optional, for UI threading).

---

## 11. Rejection, cancellation, invalidation — semantics

| State | Who triggers | Reversible? | Remaining artefacts |
|---|---|---|---|
| `rejected` | Approver | No | Packet visible in history; findings remain in source run |
| `cancelled` | Creator or admin | No | Partial execution rolled back if mid-dispatch; audit preserved |
| `invalidated` | System (pin drift) | No | Draft new packet from same findings; original archived |
| `expired` | System (timer) | No | Same as invalidated; `assessment.replay` required |

No state can be rolled back. Creation of a replacement packet is always the forward path.

---

## 12. Concurrency & conflicts

- At most **one** `executing` packet per `target.executorProfileId` per project.
- Attempting to dispatch a second → error `handoff.executor_busy { activeHandoffId }`.
- Multiple `approved` packets can wait; user picks which to dispatch.
- If a packet's pin invalidates while another is executing: invalid packet marked `invalidated` immediately; execution of other continues.

---

## 13. Rollback

Packet execution may include rollback hints:
- `tasks[].rollbackSteps[]` optional.
- On `outcome.status = failed`: bridge offers "Create rollback handoff" that converts rollback steps into new packet tasks.
- Rollback packet targets same executor profile; gets fast-track single-party approval.

For `executor.release` failures: rollback packet inherits two-party requirement.

---

## 14. Related

- [`capability-profiles.md`](./capability-profiles.md) — executor profile definitions + session gating.
- [`assessment-contract.md`](./assessment-contract.md) — source findings + RemediationPlan.
- [`evidence-freshness.md`](./evidence-freshness.md) — connector snapshot validity.
- [`gates.md`](./gates.md) — gate status may auto-trigger handoff creation.
- [`protocol.md`](./protocol.md) §3.14, §4.11 — command/event envelope.
