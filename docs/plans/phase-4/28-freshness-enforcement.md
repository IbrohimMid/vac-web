# Plan 28 — Freshness policy enforcement

**Phase**: 4 · **Depends on**: Plan 27 · **Blocks**: Plan 32 (handoff) · **Est**: 1 day

## Goal

Enforce evidence freshness at three moments: at report load, at handoff create, at gate criteria evaluation. Stale-hard blocks actions; stale-warn shows badges but allows proceed.

## Why this is hard

The temptation is to silently update stale evidence ("just re-fetch"). That's wrong: assessor evaluated state at `observed_at`; stale means state may have changed; finding's validity is questionable. The correct behaviour is **surface staleness + offer replay**, never silent refresh.

## Scope

### In
- Load-time freshness evaluation on reports.
- Confidence discount for stale-hard.
- Badge emission (`assessment.evidence_stale_detected`).
- Handoff creation rejection on stale-hard evidence.
- Gate criterion staleness flag.
- Refresh flow.

### Out
- Agent-side re-capture logic (agents don't decide when; user does via replay).
- Per-evidence manual refresh (out for v1; full replay only).

## Deliverables

```
apps/local-bridge/src/assessment/freshness/
├── mod.rs
├── evaluate.rs           # compute current state
├── discount.rs           # apply confidence reduction
├── reject_create.rs      # handoff creation guard
└── refresh.rs            # orchestrate replay
```

## Stages

### S1 — Freshness state model (0.1 day)

```rust
pub enum FreshnessState {
    Fresh,
    Aging { pct_elapsed: f32 },
    StaleWarn,
    StaleHard,
    Immutable,
    Missing,
}

pub fn evaluate(ev: &EvidenceRef, now: Instant) -> FreshnessState {
    match ev.staleness_policy {
        Immutable => Immutable,
        WarnOnly => {
            if now > ev.fresh_until { StaleWarn }
            else if now > ev.fresh_until - 0.2 * (ev.fresh_until - ev.observed_at) { Aging { ... } }
            else { Fresh }
        }
        HardExpire => { similar, stale → StaleHard }
    }
}
```

**Exit**: unit tests.

### S2 — Report load-time evaluation (0.3 day)

When `assessment.fetch_report { runId }` served:
1. Load run + findings.
2. For each finding, evaluate each evidence:
   - If any stale_hard: apply confidence discount (`confidence *= 0.5`), add badge metadata.
   - Emit `assessment.evidence_stale_detected` event for client.
3. Return report with augmented finding confidences.

Discounts idempotent (compare original captured confidence + policy).

**Exit**: report with fresh evidence — confidence preserved; report with stale — discounted.

### S3 — Finding confidence storage (0.1 day)

Persisted finding stores **original** confidence. Discount is applied dynamically at load. Reason: reload after replay should restore if evidence refreshed.

**Exit**: confidence roundtrip correct.

### S4 — Handoff creation guard (0.2 day)

In `handoff.create { fromRunIds, acceptedFindingIds }`:
```rust
for fid in accepted_finding_ids {
    let f = load_finding(fid)?;
    for ev in &f.evidence {
        if evaluate(ev, now()) == StaleHard && !ev_fresh_by_snapshot(ev) {
            bail!(HandoffError::EvidenceStaleHardExpire { finding_id, evidence_id });
        }
    }
}
```

Client-visible error: code `evidence.stale_hard_expire`, message includes suggestion to replay.

**Exit**: red-team case: stale-hard evidence finding → handoff create rejected; replay → accepted.

### S5 — Gate criterion staleness (0.2 day)

Gate criteria often reference an assessment run's verdict. If that run's evidence is stale:
- Criterion tagged `stale: true` (see `gate_status` schema).
- Listed in gate warnings (not blockers) unless policy says `stalenessBlocksGate = true` for that criterion.
- UI shows amber dot + "stale" tag in criterion row.

Gate evaluator calls freshness check as part of its logic.

**Exit**: run ages → gate re-evaluates → criterion marked stale.

### S6 — Refresh / replay orchestration (0.2 day)

User action "Refresh" on report or handoff:
- Calls `assessment.replay { runId }` (Plan 26).
- New run gets fresh evidence.
- On completion: diff generated (Plan 35); UI offers "Use fresh run for handoff."

In handoff error UI (Plan 33): "Refresh assessment" CTA inline with error message.

**Exit**: refresh flow validated end-to-end.

### S7 — Notify routing (0.1 day)

`assessment.evidence_stale_detected` routes per NotifyRouter:
- Severity: `warn` (never error).
- Lane: `persistent` (not transient — users need time to notice).
- One aggregate event per run (not per-evidence) to avoid spam.

**Exit**: stale evidence triggers persistent notify once per run load.

## Testing

- Unit: freshness state evaluation across kinds.
- Integration: load report at various times; confidence reflects.
- Handoff creation with stale evidence test.

## Exit criteria

- [ ] Confidence discounted dynamically (not baked in).
- [ ] Handoff create rejects on stale-hard; clear error.
- [ ] Gate criteria reflect staleness.
- [ ] Refresh flow documented + working.

## Risks

| Risk | Mitigation |
|---|---|
| Clock drift between bridge runs | Use monotonic + wall-clock tolerance window |
| User frustration at "always stale Sentry" | Per-family fresh_for override; can relax for low-risk contexts |
| Discount applied twice | Idempotency check (flag in meta) |

## Related

- [`evidence-freshness.md`](../../evidence-freshness.md)
- [`assessment-contract.md`](../../assessment-contract.md) §3
- Plan 27 — evidence capture
- Plan 32 — handoff consumes this
