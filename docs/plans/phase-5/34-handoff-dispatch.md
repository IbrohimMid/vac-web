# Plan 34 — Handoff dispatch + executor binding

**Phase**: 5 · **Depends on**: Plans 08, 32, 33 · **Blocks**: 35, Phase 5 exit · **Est**: 2 days

## Goal

Execute an approved `HandoffPacket`: spawn an executor session with target profile + packet tasks as initial context, check out a fresh branch at pin base commit, stream execution progress, bind packet lifecycle to session, trigger reassess on completion.

## Why this is hard

The executor session must run **only** against the pinned state. Fresh branch + pin re-verification + per-task scope narrowing + halting per `requiresApprovalPerStep` tasks are all safety mechanics. Completion can be partial (some tasks fail); lifecycle must reflect reality.

## Scope

### In
- `handoff.dispatch_local` command.
- Fresh branch checkout at pin's base_commit_sha.
- Executor session spawn with packet context.
- Task runner: send tasks to agent in correct order.
- Per-task scope narrowing: add `touches_paths` to executor profile's `scoped_paths`.
- Progress event streaming.
- Completion detection + auto reassess trigger.
- Executor session ↔ packet lifecycle binding.

### Out
- Hosted dispatch `handoff.dispatch_web_cli` (Phase 7).
- AssessmentDiff compute (Plan 35).

## Deliverables

```
apps/local-bridge/src/handoff/dispatch/
├── mod.rs
├── local.rs
├── branch.rs              # fresh branch at pin.base_commit_sha
├── task_runner.rs         # orchestrate tasks sequentially / per deps
├── progress.rs
└── reassess_trigger.rs
```

## Stages

### S1 — Preflight verification (0.2 day)

`dispatch_local`:
1. Load packet; assert state = `Approved`.
2. Re-verify pin (see Plan 32). If drift / expiry → abort with `handoff.invalidated`, transition state.
3. Assert concurrency: no other `Executing` handoff targeting same `executor_profile_id` for this project.
4. Transition state to `Dispatched`.

**Exit**: preflight test: drifted packet fails dispatch; valid packet proceeds.

### S2 — Fresh branch checkout (0.3 day)

```rust
pub async fn prepare_executor_worktree(project_root: &Path, base_sha: &str, handoff_id: &HandoffId) -> Result<WorktreeHandle> {
    let branch_name = format!("handoff/{}", handoff_id);
    git(&["checkout", "-b", &branch_name, base_sha]).await?;
    Ok(WorktreeHandle { branch_name, project_root: project_root.to_path_buf() })
}
```

If repo has local unsaved changes: prompt user (stash vs abort). UI on bridge returns error code `dispatch.worktree_dirty`; client shows modal.

Alternative: git worktree (`git worktree add`) to avoid conflicting with user's current branch. Recommended for v1.

```rust
git(&["worktree", "add", "--detach", &worktree_path, base_sha]).await?;
git_in(&worktree_path, &["checkout", "-b", &branch_name]).await?;
```

Path: `~/.local/share/vac-web/worktrees/<handoff_id>/`.

**Exit**: executor sessions operate in isolated worktree; user's branch unaffected.

### S3 — Executor session spawn (0.2 day)

Reuse `SessionRegistry.create` with:
- `profile_id = packet.target.executor_profile_id`.
- `project_root = worktree_path`.
- `handoff_id = packet.id` (validates gate per Plan 08).
- Scoped paths merged: profile defaults + packet's aggregated `tasks[].touches_paths`.

Store `executionSessionId` in packet.

Transition state to `Executing`.

**Exit**: executor session alive; bound to packet.

### S4 — Task runner (0.4 day)

Runner sends tasks to engine as structured initial prompt + subsequent directives:

```rust
pub async fn run_tasks(session: &SessionHandle, packet: &HandoffPacket) -> Result<ExecutionOutcome> {
    let plan = topo_sort(&packet.tasks);
    for task in plan {
        update_progress(packet.id, task.id, "started").await?;
        let prompt = build_task_prompt(task, packet);
        session.send_message(prompt).await?;
        let outcome = session.await_task_done(task.id).await?;   // agent signals via tool
        update_progress(packet.id, task.id, outcome.status).await?;
        if outcome.status == TaskStatus::Failed && task.fail_mode == FailMode::Abort {
            return Ok(ExecutionOutcome::Partial { completed, failed: vec![task.id] });
        }
    }
    Ok(ExecutionOutcome::Success { ... })
}
```

Agent signals task done via emitting `task.done { task_id, status, summary }` tool call (PR #7 family).

`requiresApprovalPerStep`: each step shows in approvals tab; user must approve each before agent proceeds. Otherwise task runs to completion before next task's approval.

**Exit**: multi-task packet runs to completion.

### S5 — Progress + events (0.1 day)

Emit:
- `handoff.execution_progress { handoffId, taskId, status }` per task state change.
- `handoff.completed { handoffId, outcome }` at end.

Client UI (Plan 33) shows progress live in HandoffDetail.

**Exit**: UI updates correctly.

### S6 — Completion + reassess trigger (0.2 day)

On completion (success/partial/failed):
1. Transition packet to `Completed` (with outcome flag).
2. Close executor session.
3. **Auto-trigger reassess** on each `sourceRunId`:
   ```rust
   for run_id in &packet.source_run_ids {
       assessment_manager.replay(run_id).await?;
   }
   ```
4. Store `outcome.reassessmentRunId` in packet (set to replay run id).

Reassess runs on the handoff worktree (stays there until user merges or discards).

**Exit**: completed handoff triggers auto-replay.

### S7 — Rollback path (0.2 day)

On `outcome.status = failed` (or user-initiated rollback):
- Option A: discard worktree (delete branch + worktree).
- Option B: preserve for inspection; mark branch as failed.

Default: preserve with `discard` CTA in UI. Safer for forensics.

Packet `outcome` records failure reason + failed_task_ids.

**Exit**: failure path leaves diagnostics in worktree; UI offers discard.

### S8 — Merge guidance (0.1 day)

After completion success: UI offers:
- "Open PR from handoff branch".
- "Merge to base branch" (confirms, executes in `executor.release` or manual).
- "Keep as branch".

Not automatic; user chooses.

**Exit**: merge CTA visible.

### S9 — Cancellation (0.1 day)

Mid-dispatch cancel: `handoff.cancel` during `Dispatched`/`Executing`:
- Send cancel to executor session.
- Graceful: 5s for agent to stop; else force-close.
- State → `Cancelled`.
- Worktree preserved for review.

**Exit**: cancel mid-run clean.

### S10 — Concurrency enforcement (0.1 day)

Check at dispatch: "one executing per profile per project."

Violation → error `handoff.executor_busy { activeHandoffId }`. UI shows active handoff.

**Exit**: RT case passes.

### S11 — Red-team + audit (0.1 day)

Audit entries for every transition + task event.

Red-team coverage:
- RT-038: executor session without handoff → rejected (Plan 08 already).
- RT-042: handoff.dispatch with mismatched profile → rejected.
- Profile enforcement during execution: agent attempts write outside touches_paths → bridge denies.

**Exit**: red-team complete.

## Testing

- Unit: task runner, worktree prep.
- Integration: full dispatch cycle on fixture repo.
- Failure injection: task fails mid-plan → partial outcome.
- Cancel mid-run.

## Exit criteria

- [ ] Approved packet dispatches → executor session in worktree → tasks run → completed.
- [ ] Reassess auto-triggers.
- [ ] Cancel works; rollback preserves diagnostics.
- [ ] Concurrency cap enforced.
- [ ] Scoped_paths narrows executor writes as declared.

## Risks

| Risk | Mitigation |
|---|---|
| Worktree conflicts with user's main branch | git worktree isolation |
| Task parallelism race | Topo sort enforces dependency order; strict sequential unless `parallelSafe: true` |
| Agent ignores approval-per-step | Engine enforces at tool layer (same as normal approval) |
| Reassess runs on wrong commit | Runs in worktree where changes exist; base_sha for comparison is packet pin |

## Related

- [`handoff-contract.md`](../../handoff-contract.md) §6–§7
- Plan 08 — executor session gating
- Plan 32 — pin verification reused
- Plan 35 — reassess diff
