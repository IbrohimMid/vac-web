# Handoff — implementation plan

**Goal.** Evolve Handoff from "create packet from selected findings" (Stage J) to the full spec at [`../product-specs/handoff.md`](../product-specs/handoff.md): pinned packets with task scope, two-party + per-step approvals, ACP executor dispatch, scope enforcement, auto-reassess loop.

**Depends on.** Stage X.5 (approval bridge), X.6 (Claude executor), [`20-assess.md`](./20-assess.md) Stage A2 (evidence verification — packets pin evidence).

**Out of scope.** Production release dispatch (see [`22-release.md`](./22-release.md)). Migration profile + ACP (deferred).

---

## H1 — Pin model

Add `pin` to `HandoffPacket`: `repoRef`, `baseCommitSha`, `worktreeDigest`, `connectorSnapshots[]`, `expiresAt`, `invalidationPolicy` (`strict` | `lenient`). Compute on draft creation.

**Exit.** Pin reverified at approval and at dispatch; mismatch → `invalidated` state.

## H2 — Task model upgrade

Today `tasks[]` is title + finding refs. Add `touchesPaths`, `constraints`, `riskNotes`, `estEffort`, `dependsOn`, `requiresApprovalPerStep`, `rollbackSteps`. Drag-reorder respecting `dependsOn`.

**Exit.** Spec §10 + §11 covered; reorder respects topological sort.

## H3 — Approval state machine

Replace the current single approve button with the spec lifecycle: `draft → pending_approval → approved → dispatched → executing → completed | rejected | cancelled | invalidated | expired`. Two-party rule fires when any finding is critical or `target.profileId` is `executor.release@*`.

**Exit.** Red-team cases H04, H05, H09, H10 pass; `stateHistory[]` records every transition.

## H4 — Dispatch target with `agent_id`

Extend `target` from `executorProfileId` to `{executorProfileId, agentId, agentKind, agentRole}`. UI picker shows runtime options compatible with the chosen profile (matrix in spec §13).

**Exit.** Dispatch with `agentId=claude` opens an ACP-driven Build session (links to [`23-build.md`](./23-build.md) Stage B5).

## H5 — Scope enforcement at the executor boundary

Bridge tracks `aggregated tasks[].touchesPaths + test files`. Out-of-scope file write → either deny outright or trigger `approval.pending` for scope expansion (spec §15). Default deny.

**Exit.** Red-team cases H06, H07, H08 pass; scope-expansion approvals append to packet `stateHistory`.

## H6 — Per-step approval

When `requiresApprovalPerStep=true`, executor pauses between steps. UI shows current step + approve/reject controls.

**Exit.** Critical/migration packets walk through step-by-step in dev.

## H7 — Auto-reassess

On `handoff.completed`, bridge issues `assessment.replay` for the source run(s). Diff resolved/persistent/new/regressed surfaces in the packet completion view.

**Exit.** Red-team cases H13, H14 pass; UI shows assessment delta block on completed packets.

## H8 — Rollback packet generator

Failed/partial packets offer "Create rollback handoff" — rollback steps from completed/failed tasks become the new packet's tasks; same `executorProfileId`; fast-track approval unless release profile.

**Exit.** Manual rollback flow lands a green packet on a deliberately-failed dev run.

---

## Risks / open questions

- `worktreeDigest` cost on large repos: may need a sampled hash if full-tree hashing is too slow at approval time.
- Scope expansion UX: approve-once vs. broaden-touchesPaths is genuinely ambiguous; H5 starts with one-shot approval and revisits if users complain.
- Connector-snapshot expiry vs. packet expiry: pick the tighter of the two as effective expiry.
