# Assess — implementation plan

**Goal.** Bring Assess from the v1 baseline (mock-engine driven, single-pass) up to the spec at [`../product-specs/assess.md`](../product-specs/assess.md): structured candidate→validated finding pipeline, depth-budget continuation, ACP read-only worker support, evidence verification, gate feed.

**Depends on.** [`10-stage-x-agent-runtime.md`](./10-stage-x-agent-runtime.md) Stages X.5 (permission bridge) and X.7 (ACP read-only mode).

**Out of scope.** Stage K VIL/VWFD; gate finalization (Release plan owns that).

---

## A1 — Candidate→Validated pipeline split

Today the mock engine emits `AssessmentFinding` directly. Introduce a `CandidateFinding` shape coming from the worker, and a bridge validator that produces `AssessmentFinding`. Mock engine emits candidates too, for symmetry.

**Validation rules** (from spec §13): valid JSON, schema, evidence presence, evidence file/line existence, projectRoot containment, severity/category whitelist, critical-confidence floor, identityHash dedup.

**Exit.** Same UI behavior end-to-end on mock; rejected candidates produce `assessment.candidate_rejected` audit rows.

## A2 — Evidence verification

Resolve every `EvidenceRef` against the pinned repo (`projectRoot` + `repoRef`). Reject candidates whose path/line doesn't exist. Mark stale evidence beyond `freshUntil`.

**Exit.** Red-team cases A03, A04, A09 pass.

## A3 — Depth budget + continuation

`AssessmentRun.depthBudget` with `targetSeconds`, `earlyThresholdSeconds`, `maxContinuationPasses`. If a worker completes before threshold, bridge issues continuation prompt (template in spec §9). Stop conditions: budget consumed, max passes, two consecutive empty passes, user cancel, worker fail.

**Exit.** Red-team cases A07, A08, A12 pass; `assessment.continuation_requested` events visible in Activity rail.

## A4 — ACP assessment-worker driver

Wire Stage X.7 into the assessment dispatcher. Worker receives the structured prompt, returns JSON candidates only. No write/shell. `agent_id` + `agent_kind` recorded on the run.

**Exit.** Red-team cases A01, A02, A05, A06, A10, A11 pass.

## A5 — Verdict synthesis

Bridge computes verdict from validated findings using the family-specific rules (RTD/Release, Security/Reliability, Product/UX). Worker-suggested verdicts are advisory only.

**Exit.** Spec §14 rules covered by unit tests in `apps/bridge`.

## A6 — Report detail enhancements

Stage J already shipped the in-place report toggle. Add: severity filter, category filter, finding defer, comparison to last run, evidence chip → file open via `review.open_file`.

**Exit.** Spec §15.3 acceptance items render.

## A7 — Gate feed

Verdict → gate recommendation per spec §19. Gate finalization stays in the Release plane — Assess only emits the recommendation event.

**Exit.** ReadyToDeploy / ReadyToPublish reflect Assess verdict changes within one tick.

---

## Risks / open questions

- Evidence freshness policy already has a doc ([`../evidence-freshness.md`](../evidence-freshness.md)); A2 must reconcile with it rather than duplicate.
- Continuation prompt drift: if worker keeps returning the same finding, A3's "two empty passes" rule is what stops the loop — make sure dedup runs *before* the empty-check.
- Evidence on connector data (not files) needs an extra verifier; defer to a follow-up if connector snapshots aren't available at validation time.
