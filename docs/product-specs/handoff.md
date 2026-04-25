# Product Spec — VAC Handoff

**Status**: 🔵 product spec; depends on Stage X agent-runtime + existing handoff-contract.md
**Audience**: anyone implementing Handoff packet flow, approval, dispatch, or executor binding
**Companion docs**: [`agent-runtime.md`](../agent-runtime.md), [`../handoff-contract.md`](../handoff-contract.md), [`assess.md`](./assess.md), [`build.md`](./build.md), [`release.md`](./release.md)

---

## 1. Product Summary

**VAC Handoff** adalah workflow untuk mengubah hasil assessment yang sudah tervalidasi menjadi paket kerja terstruktur yang aman dieksekusi oleh agent executor.

Handoff menjawab pertanyaan:

```
Assessment menemukan masalah.
Sekarang apa yang harus dikerjakan?
Siapa/agent mana yang mengerjakan?
Boleh menyentuh file apa?
Evidence-nya apa?
Approval-nya siapa?
Bagaimana progress dan hasilnya masuk kembali ke web?
```

Target flow:

```
AssessmentFinding validated
  → user selects findings
  → bridge creates HandoffPacket
  → user reviews packet/tasks/constraints/rationale
  → approval
  → dispatch to selected executor agent
  → Claude/VAC/OpenCode executes
  → bridge tracks progress, diff, logs, approvals
  → auto-reassess
  → report resolved / persistent / regressed / new
```

---

## 2. Goal

Handoff harus menjadi **safe execution bridge** antara Assess dan Build/Executor.

Goals:

```
1. Mengubah validated findings menjadi task packet yang actionable.
2. Menjaga context assessment tetap pinned dan reproducible.
3. Memilih executor target: local VAC, Claude Code ACP, OpenCode ACP, Web CLI, atau blueprint export.
4. Menjamin semua execution tetap melewati bridge policy, approval, audit, dan profile gating.
5. Menampilkan progress otomatis di Handoff page, Activity rail, Review, Runtime, dan Assessment diff.
6. Menjalankan auto-reassess setelah executor selesai.
7. Mencegah stale packet, scope creep, dan execution terhadap repo state yang sudah drift.
```

---

## 3. Non-goals

Handoff tidak boleh menjadi:

```
- Free-form prompt launcher ke Claude.
- Shortcut untuk bypass assessment validation.
- Shortcut untuk bypass approval.
- Mechanism untuk deploy/release tanpa gate.
- Executor yang boleh memperluas task scope sendiri.
- Tempat external ACP agent menentukan status gate final.
- UI-only checklist tanpa pinned repo/evidence context.
```

---

## 4. Core Principle

```
Assessment says what is wrong.
Handoff says what may be fixed.
Executor proposes and applies changes.
Bridge enforces, records, and verifies.
```

Aturan paling penting:

```
No validated finding → no handoff task.
No approved packet → no executor mutation.
No pin verification → no dispatch.
No bridge audit → no execution.
```

---

## 5. Handoff Users

| User               | Need                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| Reviewer           | Memastikan findings yang dipilih benar dan evidence cukup.              |
| Engineer / Builder | Melihat task yang jelas, scope file, constraints, dan expected outcome. |
| Release owner      | Approve packet yang high-risk atau release-related.                     |
| VAC operator       | Dispatch packet ke agent executor dan monitor progress.                 |
| PM / Product owner | Melihat rationale dan business/UX impact dari task.                     |

---

## 6. Handoff Surface

### 6.1 Handoff Packet Draft Page

Halaman utama harus punya:

```
- Back to report
- Packet title
- Source run + target executor profile
- Ordered tasks
- Task evidence chips
- Task estimates
- Constraints & rationale
- Packet side panel
- Dispatch target selector
- Sign-off options
- Approve & dispatch CTA
- Save draft
```

### 6.2 Packet Side Panel

Side panel wajib menampilkan:

```
- Packet ID
- State: draft / approved / executing / completed / invalidated
- Source runs
- Number of tasks
- Risk level
- Estimated effort
- Snapshot commit
- Fresh until
- Target executor
- Approval requirements
- Auto-reassess setting
```

### 6.3 Activity Rail Integration

Activity rail harus menampilkan:

```
- Packet created
- Packet approved
- Dispatch started
- Executor applied patch
- Approval requested
- Task completed
- Reassess started
- Reassess completed
- Packet completed / failed / invalidated
```

---

## 7. Handoff Lifecycle

State machine product-level:

```
draft
  → pending_approval
  → approved
  → dispatched
  → executing
  → completed
```

Terminal states:

```
rejected
cancelled
invalidated
expired
completed
```

Existing contract already defines this lifecycle and explicitly states that every transition is logged in `stateHistory` and emitted as event.

---

## 8. Handoff Creation

### 8.1 Source

Handoff can only be created from:

```
- validated AssessmentFinding
- validated AssessmentRun
- validated AssessmentDiff
- optional RemediationPlan generated from assessment
```

Creation entry points:

```
- Assessment report: selected findings → Create handoff
- Finding row: Add to handoff
- Assess landing recommendation: Review handoff
- Reassessment result: Create follow-up handoff
- Failed execution: Create rollback handoff
```

### 8.2 Input

```json
{
  "sourceRunIds": ["run_01"],
  "acceptedFindingIds": ["fnd_01", "fnd_02", "fnd_03"],
  "title": "Fix deployment blockers for payments-svc",
  "target": {
    "executorProfileId": "executor.code@1.0.0",
    "agentId": "claude",
    "agentKind": "acp"
  }
}
```

`agentId` adalah tambahan Stage X. Existing contract sudah punya `target.executorProfileId`; Stage X menambah pilihan runtime agent di dalam target packet.

---

## 9. Handoff Packet Data Model

### 9.1 Top-level Packet

```json
{
  "id": "handoff_01",
  "title": "Fix RTD blockers for payments-svc",
  "summary": "Resolve 3 blockers before Ready to Deploy can pass.",
  "sourceRunIds": ["run_rtd_01"],
  "acceptedFindingIds": ["fnd_01", "fnd_02", "fnd_03"],
  "createdBy": "usr_01",
  "createdAt": "2026-04-25T10:51:00Z",
  "state": "draft",
  "risk": "medium",
  "estEffort": "~45m",
  "pin": {},
  "tasks": [],
  "target": {},
  "approval": {},
  "stateHistory": []
}
```

### 9.2 Pin

Pin captures repo/evidence context:

```json
{
  "repoRef": "payments-svc@7e3a91f",
  "baseCommitSha": "7e3a91f...",
  "worktreeDigest": "sha256:...",
  "assessmentSnapshotAt": "2026-04-25T10:51:00Z",
  "connectorSnapshots": [
    {
      "connectorId": "github:payments-svc",
      "kind": "github",
      "snapshotId": "gh_snap_01",
      "capturedAt": "2026-04-25T10:50:00Z"
    }
  ],
  "expiresAt": "2026-04-26T10:51:00Z",
  "invalidateOnRepoChange": true,
  "invalidationPolicy": "strict"
}
```

Pin matters because executor should act on the same repo state that assessment saw. Existing contract defines pin as repo ref, base commit, worktree digest, connector snapshots, assessment timestamp, expiry, and invalidation policy.

---

## 10. Task Model

Each finding becomes one or more tasks.

```json
{
  "id": "task_01",
  "sourceFindingIds": ["fnd_01"],
  "title": "Bind idempotency key expiry to monotonic TTL",
  "rationale": "Critical RTD blocker. Stale keys can mask or replay payment state.",
  "evidenceRefs": ["ev_01", "ev_02"],
  "steps": [
    "Inspect current charge idempotency path.",
    "Bind Redis TTL to monotonic expiry window.",
    "Verify replay path rejects expired keys.",
    "Add regression test for Redis failover."
  ],
  "constraints": [
    "Do not change public API response schema.",
    "Do not touch unrelated handlers.",
    "Preserve idempotent retry semantics."
  ],
  "riskNotes": [
    "Incorrect TTL may break legitimate retries."
  ],
  "estEffort": "~15m",
  "dependsOn": [],
  "touchesPaths": [
    "src/handlers/charge.rs",
    "src/idempotency/**",
    "tests/**"
  ],
  "requiresApprovalPerStep": false,
  "rollbackSteps": [
    "Revert idempotency TTL patch.",
    "Disable new TTL enforcement behind feature flag if added."
  ]
}
```

Task quality rules:

```
- Title must be imperative/actionable.
- Every task must link to at least one evidence ref.
- touchesPaths must be narrow.
- constraints must preserve assessment intent.
- risk notes required for critical/high findings.
- estimated effort required.
- rollback steps recommended for critical/release tasks.
```

---

## 11. Task Ordering

Handoff must support ordered tasks.

Ordering sources:

```
1. Assessment RemediationPlan dependency graph.
2. Finding severity.
3. Explicit dependency relation.
4. User drag-and-drop order.
5. Bridge topological sort if dependencies exist.
```

Rules:

```
- Blocking dependencies must execute first.
- User can reorder only if dependency constraints are not violated.
- Bridge warns if order increases risk.
- Executor receives ordered task list.
```

---

## 12. Constraints & Rationale

This section is critical for Claude Code / ACP execution.

Packet-level constraints:

```
- Must stay on feat/idempotency branch.
- No schema breaking changes.
- No release/deploy command.
- No migration unless explicitly approved.
- Wall-clock-free TTL preferred.
- Preserve existing API contract.
```

Rationale must explain:

```
- Why this packet exists.
- Which assessment findings it addresses.
- What must not be changed.
- What success looks like.
- What must be reassessed after completion.
```

Executor sees rationale as initial context, not as optional UI text.

---

## 13. Dispatch Target

### 13.1 Target options

```
- Local VAC executor
- Claude Code ACP executor
- OpenCode ACP executor
- Web CLI executor
- Export blueprint only
```

### 13.2 Target shape

```json
{
  "kind": "dispatch_to_local_agent",
  "executorProfileId": "executor.code@1.0.0",
  "agentId": "claude",
  "agentKind": "acp",
  "agentRole": "handoff-executor",
  "sessionTitle": "Fix RTD blockers for payments-svc"
}
```

### 13.3 Agent compatibility

| Target profile         | VAC native |   Claude ACP | OpenCode ACP | Mock | Notes                                     |
| ---------------------- | ---------: | -----------: | -----------: | ---: | ----------------------------------------- |
| `executor.code@*`      |        yes |          yes |          yes |  yes | Code fixes allowed with approval.         |
| `executor.release@*`   |        yes | initially no | initially no |  yes | Release authority remains restricted.     |
| `executor.migration@*` |        yes |           no |           no |   no | Migration safety requires VAC-native.     |
| `assessor.*@*`         |        n/a |          n/a |          n/a |  n/a | Handoff does not target assessor profile. |

---

## 14. Claude Code / ACP Execution Mode

Claude Code can execute handoff tasks, but only as controlled executor.

Flow:

```
handoff.dispatch_local
  → bridge verifies packet
  → bridge spawns executor session with agent_id = claude
  → bridge sends structured packet context
  → Claude proposes edits/tool calls
  → bridge checks profile + packet scope
  → approvals if needed
  → file changes/runtime logs emitted to web
  → task progress updated
```

Claude receives:

```json
{
  "handoffId": "handoff_01",
  "profileId": "executor.code@1.0.0",
  "repoPin": "7e3a91f",
  "tasks": [],
  "constraints": [],
  "evidence": [],
  "allowedPaths": [],
  "forbiddenActions": [
    "deploy",
    "push",
    "schema-breaking-change",
    "unrelated-refactor"
  ],
  "expectedOutput": {
    "taskProgress": true,
    "changesetSummary": true,
    "testsRun": true,
    "reassessmentHints": true
  }
}
```

Claude must not free-roam beyond packet scope.

---

## 15. Scope Enforcement

Executor may only touch:

```
aggregated tasks[].touchesPaths
+ test files required by those tasks
+ explicitly approved additional files
```

If executor tries to touch out-of-scope file:

```
1. Bridge blocks.
2. Emits approval.pending only if expansion is plausibly related.
3. User must approve scope expansion.
4. Audit logs reason.
5. Packet scope is amended only after approval.
```

Default behavior: deny.

---

## 16. Approval Model

### 16.1 Single-party approval

For normal medium/high code packet:

```
User reviews packet.
User clicks Approve & dispatch.
Bridge verifies pin.
Bridge dispatches executor session.
```

### 16.2 Two-party approval

Required if:

```
- any accepted finding is critical
- target profile is executor.release
- packet touches sensitive paths
- packet includes migration/database changes
- policy marks packet twoParty = true
```

Existing contract already requires two-party approval for critical findings and release executor profiles.

### 16.3 Per-step approval

If `requiresApprovalPerStep = true`:

```
- Executor cannot proceed task step without approval.
- UI shows current step.
- Approve step / reject step.
- Rejected step pauses packet.
```

Useful for:

```
- production-impacting fixes
- migrations
- security-sensitive changes
- release tasks
```

---

## 17. Execution Progress

### 17.1 Task statuses

```
pending
running
blocked
needs_approval
completed
failed
skipped
```

### 17.2 Packet execution states

```
dispatched
executing
completed
failed
partial
cancelled
invalidated
```

### 17.3 Events

Bridge emits:

```
handoff.dispatched
handoff.execution_progress
handoff.completed
handoff.invalidated
handoff.expired
activity.appended
review.changeset_updated
runtime.jobs_updated
runtime.job_log
approval.pending
approval.resolved
```

Existing contract defines handoff events and dispatch flow, including `handoff.execution_progress` and `handoff.completed`.

---

## 18. Review / Diff Integration

When executor modifies files:

```
bridge observes file write
  → check path scope
  → compute diff
  → emit review.changeset_updated
  → attach changed files to task progress
```

Handoff page should show:

```
- Files changed per task
- Diff summary
- Tests run
- Runtime jobs
- Approval decisions
- Remaining tasks
```

---

## 19. Auto-Reassess

After execution completes:

```
handoff.completed
  → bridge triggers assessment.replay for sourceRunIds
  → new run compares against old run
  → UI shows resolved / persistent / new / regressed
```

Auto-reassess can be user-controlled:

```
[✓] Auto-reassess after executor completes
[ ] Notify on every approval prompt
```

If auto-reassess is enabled, packet completion is not fully “closed” until reassessment result is known.

---

## 20. Completion Outcome

```json
{
  "status": "success",
  "tasksCompleted": ["task_01", "task_02"],
  "tasksFailed": [],
  "changesetSummary": "3 files changed, 2 tests added",
  "testsRun": [
    {
      "command": "cargo test -p payments",
      "status": "passed"
    }
  ],
  "reassessmentRunId": "run_02",
  "assessmentDelta": {
    "resolved": 2,
    "persistent": 1,
    "new": 0,
    "regressed": 0
  }
}
```

Outcome states:

| Outcome       | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `success`     | All tasks completed and reassess improved/resolved target findings. |
| `partial`     | Some tasks complete, some blocked/failed.                           |
| `failed`      | Executor could not safely complete.                                 |
| `cancelled`   | User/admin cancelled.                                               |
| `invalidated` | Pin drift or stale evidence invalidated packet.                     |

---

## 21. Invalidation

Packet becomes invalid if:

```
- base commit no longer reachable
- worktree digest drifted under strict policy
- relevant touched paths drifted under lenient policy
- evidence expired
- connector snapshot stale
- packet expired
- user changes accepted findings after approval
```

Bridge verifies at:

```
1. approval time
2. dispatch time
3. during execution if repo drift is detected
4. before auto-reassess linkage
```

Existing contract requires pin verification at approval and dispatch.

---

## 22. Rejection and Cancellation

### Rejection

Approver rejects packet:

```
handoff.reject { reason }
```

Rules:

```
- reason min 10 chars
- packet terminal
- findings remain available
- user may create replacement packet
```

### Cancellation

User cancels executing packet:

```
handoff.cancel
```

Rules:

```
- executor session terminated
- partial changes preserved or rolled back depending on policy
- audit preserved
- status cancelled
```

---

## 23. Rollback Handoff

If execution fails after changes:

```
bridge offers Create rollback handoff
```

Rollback packet:

```
- source = failed handoff outcome
- tasks = rollbackSteps from completed/failed tasks
- target = same executorProfileId
- approval = fast-track unless release profile
```

For release-related rollback, two-party approval remains required.

---

## 24. Handoff Audit

Every packet transition logs:

```json
{
  "ts": "2026-04-25T10:51:00Z",
  "handoffId": "handoff_01",
  "transition": "approved -> dispatched",
  "by": "usr_01",
  "pinDigest": "sha256:...",
  "profileId": "executor.code@1.0.0",
  "agentId": "claude",
  "agentKind": "acp"
}
```

Every executor tool decision logs:

```json
{
  "event": "handoff.executor_tool_decision",
  "handoffId": "handoff_01",
  "taskId": "task_01",
  "agentId": "claude",
  "tool": "fs.write",
  "path": "src/handlers/charge.rs",
  "decision": "approved",
  "argsHash": "sha256:...",
  "diffHash": "sha256:...",
  "actor": "usr_01"
}
```

---

## 25. Handoff + Agent Runtime Picker

Stage X changes target selection from profile-only to profile + agent.

Before:

```json
{
  "executorProfileId": "executor.code@1.0.0"
}
```

After:

```json
{
  "executorProfileId": "executor.code@1.0.0",
  "agentId": "claude",
  "agentKind": "acp"
}
```

Rules:

```
- agentId locked at dispatch session creation
- executor session cannot switch agent mid-packet
- packet can be exported and redispatched with another agent only by creating replacement packet
```

---

## 26. UI Requirements

### 26.1 Draft state

Show:

```
- task list
- reorder handle
- evidence chips
- severity/category badges
- constraints
- target agent selector
- packet risk
- fresh until
- approve & dispatch
```

### 26.2 Approval state

Show:

```
- required approvers
- current signatures
- pin verification status
- approval notes
- reject action
```

### 26.3 Executing state

Show:

```
- active agent
- current task
- current step
- pending approval prompts
- runtime jobs
- changed files
- task progress
- elapsed time
```

### 26.4 Completed state

Show:

```
- outcome
- completed tasks
- failed tasks
- changeset summary
- reassessment result
- resolved/persistent/new/regressed
- create follow-up handoff
- export report
```

---

## 27. Product Acceptance Criteria

### Creation

```
- User can create packet from selected validated findings.
- Packet includes source run, findings, pin, tasks, constraints, target.
- Packet cannot be created without findings/evidence.
```

### Draft editing

```
- User can reorder tasks.
- User can add rationale/constraints.
- User can select target executor.
- Bridge validates target/profile compatibility.
```

### Approval

```
- Single-party approval works.
- Two-party approval required for critical/release packets.
- Pin reverified at approval.
- Approval logged.
```

### Dispatch

```
- Dispatch creates executor session.
- Executor receives structured packet.
- Agent cannot expand scope silently.
- Out-of-scope tool/file action denied or approval-gated.
```

### Execution

```
- Task progress appears in web.
- File diffs appear in Review.
- Runtime logs appear in Runtime/Activity.
- Approval prompts appear in UI.
```

### Completion

```
- Packet records outcome.
- Auto-reassess can run.
- Assessment diff shows resolved/persistent/new/regressed.
- User can create follow-up or rollback handoff.
```

---

## 28. Red-Team Cases

```
H01: Create handoff with no findings → reject.
H02: Create handoff from unvalidated finding → reject.
H03: Finding evidence missing/stale → reject or require reassess.
H04: Approve packet after repo drift → invalidated.
H05: Dispatch packet after pin expiry → expired.
H06: Claude tries to edit file outside touchesPaths → deny.
H07: Claude asks to run deploy from executor.code packet → deny.
H08: Claude tries to add unrelated refactor → require explicit scope expansion approval.
H09: Critical finding packet with one approver → remains pending approval.
H10: Release profile packet without release_manager role → reject.
H11: Executor session crashes mid-task → packet partial/failed with audit.
H12: User cancels executing packet → session killed and packet cancelled.
H13: Reassess after completion shows finding persistent → packet outcome partial.
H14: Reassess shows regression → create follow-up handoff recommendation.
H15: Two packets try executing same profile/project simultaneously → second blocked.
H16: Connector snapshot expired before dispatch → invalidated.
H17: Agent tries to change agent_id mid-session → reject.
H18: Raw markdown execution result without task status → not accepted as completion.
```

---

## 29. Rollout Plan

### Handoff V1 — Structured packet

```
- Create packet from findings.
- Show tasks/constraints/rationale.
- Save draft.
```

### Handoff V2 — Approval and pin verification

```
- Single/two-party approval.
- Pin revalidation.
- State machine/audit.
```

### Handoff V3 — Dispatch to mock/VAC executor

```
- Spawn executor session.
- Track progress.
- Emit handoff events.
```

### Handoff V4 — ACP executor support

```
- Target agentId = claude/opencode.
- Bridge sends structured packet.
- ACP tool/file/shell actions policy-gated.
```

### Handoff V5 — Auto-reassess and closure

```
- Reassess after completion.
- Diff resolved/persistent/new/regressed.
- Follow-up/rollback handoff.
```

---

## 30. Final Product Rule

```
Handoff is not a prompt.
Handoff is a pinned, approved, scoped, auditable execution packet.
```

Dengan Claude Code:

```
Claude executes the packet.
Bridge enforces the packet.
Web displays the packet lifecycle.
VAC owns the safety model.
```
