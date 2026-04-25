# Build — implementation plan

**Goal.** Promote Build from "transcript + composer + workbench tabs" (Stages C/F/I) to the spec at [`../product-specs/build.md`](../product-specs/build.md): full ACP executor support, real approvals/review/runtime telemetry, handoff-bound sessions, reviewer→Assess loop.

**Depends on.** Stage X.4 (`agent_id`), X.5 (approval bridge), X.6 (Claude real handshake). Handoff H4–H6 for handoff-launched sessions.

**Out of scope.** Stage K (VIL/VWFD become real consumers). Production deploy from Build (always redirected to Release).

---

## B1 — Session model with `agent_id`

Lock `agent_id` per session. UI exposes runtime picker at session-create (Stage X.8). Switching agent forces a new session.

**Exit.** Red-team case B10 passes; `agent_id` recorded on `session.created` audit.

## B2 — Slash command normalization

Slash palette routes `/plan`, `/implement`, `/test`, `/review`, `/assess`, `/handoff`, `/vil`, `/vwfd` through structured `message.submit` intents. None bypass profile enforcement.

**Exit.** Slash commands trigger the same protocol commands as toolbar actions; no new bypass paths.

## B3 — Real Approvals tab

Replace derived-from-mock items with live `approval.pending` events from the bridge. Approve/reject/inspect/approve-all-scoped buttons wire to `approval.*` commands.

**Exit.** Red-team case B06 passes; `Approvals` badge counts real pending items.

## B4 — Real Review tab

Replace placeholder with a changeset rendered from `review.changeset_updated` events. Hunk select, revert file, revert all. Cards link back to transcript tool calls.

**Exit.** A Claude patch via X.6 surfaces in Review, can be reverted file-by-file.

## B5 — Handoff-launched sessions

When session source is a handoff packet: `Plan` tab renders the packet's tasks, `touchesPaths` define scope, constraints become initial agent context. Completion updates the packet (links to [`21-handoff.md`](./21-handoff.md) Stage H7 reassess).

**Exit.** Red-team case B14 passes (unrelated refactor denied).

## B6 — Real Runtime tab

Stream `runtime.job_log` to a per-job log view. Backpressure on large logs (chunk + truncate with "open full log" affordance). Cancel via `runtime.cancel_job`.

**Exit.** Red-team case B07 passes; `cargo test` style commands stream cleanly.

## B7 — Agents lanes from real telemetry

Replace `AgentsView`'s derive-from-state heuristic with explicit lane states emitted by the bridge: `lane`, `status`, `workingOn`, `currentTool`, optional `tokenUsage` (only when the driver provides it; no fakes — see B12 red-team).

**Exit.** Lanes match what the agent is actually doing within one tick; no fabricated token budgets.

## B8 — Reviewer → Assess loop

Reviewer lane triggers `assessment.run` (quick depth) on the changeset's primary subsystem. Findings link back into transcript and into Assess Report.

**Exit.** A patch in Build → automatic quick reliability assessment → finding visible in both Build transcript and Assess Report.

## B9 — Memory tab v1

Distinguish `pinned` (user/bridge approved) from `auto` (derived, may decay). User can pin/unpin facts. Pinned memory survives session close.

**Exit.** Pinned facts persist across new sessions in the same project; auto facts age out.

## B10 — Build → Release redirect

User intent like "deploy this" in composer is intercepted: bridge proposes either opening Release plane or creating a release handoff. Build never executes deploy directly.

**Exit.** Red-team case B03 passes.

---

## Risks / open questions

- ACP token-usage telemetry isn't standard across providers; B7 must keep `tokenUsage` optional and never invent it.
- Hunk-level revert (B4) needs a robust diff library; reuse existing review tooling rather than rolling our own.
- Reviewer auto-assessment cost (B8): on every patch could be expensive — gate on changeset size or explicit reviewer-lane trigger.
