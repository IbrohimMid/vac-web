# Plan 35 — AssessmentDiff + convergence guard

**Phase**: 5 · **Depends on**: Plans 26, 34 · **Blocks**: Phase 5 exit · **Est**: 1.5 days

## Goal

Compute `AssessmentDiff` between two runs of the same family and render it in the UI. Convergence counter tracks when a handoff chain stops improving; escalates after 3 stuck cycles.

## Why this is hard

Diff correctness hinges on the identity hash matching Plan 27's hash. Edge cases: findings rewording, severity shifts, evidence mutation, missed dedup. UI must make "resolved / persistent / regressed / new" categories unambiguous.

## Scope

### In
- Bridge: `assessment.diff` computation, convergence tracking.
- Web: AssessmentDiff viewer with 4 tabs.
- Auto-trigger after reassess (from Plan 34).
- Convergence guard notify.

### Out
- Cross-family diff (N/A; diffs within one family).
- Evidence-level diff (post-v1; v1 diffs at finding level).

## Deliverables

```
apps/local-bridge/src/assessment/diff/
├── mod.rs
├── compute.rs
├── convergence.rs
└── storage.rs
apps/web/src/components/Workbench/AssessmentReport/
├── AssessmentDiff.tsx
├── DiffTabs.tsx
├── ResolvedFindings.tsx
├── PersistentFindings.tsx
├── RegressedFindings.tsx
├── NewFindings.tsx
└── VerdictDelta.tsx
```

## Stages

### S1 — Diff compute (0.3 day)

```rust
pub async fn compute_diff(base: &AssessmentRun, head: &AssessmentRun) -> AssessmentDiff {
    assert_eq!(base.family_id, head.family_id);
    let mut resolved = vec![];
    let mut persistent = vec![];
    let mut regressed = vec![];
    let mut new_findings = vec![];

    let head_map: HashMap<_, _> = head.findings.iter().map(|f| (f.identity_hash.clone(), f)).collect();
    let base_map: HashMap<_, _> = base.findings.iter().map(|f| (f.identity_hash.clone(), f)).collect();

    for hf in &head.findings {
        match base_map.get(&hf.identity_hash) {
            None => new_findings.push(hf.id.clone()),
            Some(bf) if bf.severity < hf.severity => regressed.push(RegressedEntry { finding_id: hf.id.clone(), severity_before: bf.severity, severity_after: hf.severity, drift_evidence: diff_evidence(bf, hf) }),
            Some(_) => persistent.push(PersistentEntry { finding_id: hf.id.clone(), unchanged_reason: None }),
        }
    }
    for bf in &base.findings {
        if !head_map.contains_key(&bf.identity_hash) {
            let resolution_ev = find_resolution_evidence(bf, head).await;
            resolved.push(ResolvedEntry { finding_id: bf.id.clone(), resolution_evidence: resolution_ev });
        }
    }
    AssessmentDiff { base_run_id: base.id.clone(), head_run_id: head.id.clone(), family_id: base.family_id.clone(), resolved, persistent, regressed, new_findings: new_findings, verdict_delta: compare_verdicts(&base.verdict, &head.verdict), convergence_counter: 0, computed_at: now() }
}
```

**Exit**: deterministic diff; fixture tests.

### S2 — Convergence counter (0.2 day)

Tracked per **handoff chain**:
```rust
pub struct ConvergenceTracker {
    chains: DashMap<ChainId, ChainState>,
}
pub struct ChainState {
    chain_id: ChainId,          // hash of source_run_ids for deterministic chain identity
    handoff_history: Vec<HandoffId>,
    diff_history: Vec<DiffOutcome>,   // improved | same | worsened
    stuck_count: u32,
}
```

After each handoff completes + reassess + diff:
- If `verdict_delta.direction == Improved` → reset stuck_count to 0.
- Else → increment.
- If `stuck_count >= 3`: emit `notify.event { severity: warn, actionId: 'escalate_manual_review' }`.

**Exit**: 3 stuck cycles triggers notify.

### S3 — Storage (0.1 day)

Diffs persisted at `~/.local/share/vac-web/diffs/<diff_id>.json`. Linked from both runs.

**Exit**: diff retrievable by id or by (base, head) pair.

### S4 — `AssessmentDiff` command (0.1 day)

`assessment.diff { baseRunId, headRunId }` → returns existing or computes + caches.

Client uses for on-demand comparison between arbitrary runs.

**Exit**: command works.

### S5 — Auto-trigger (0.1 day)

Plan 34's reassess completion flow calls diff automatically:
```rust
on reassess_completed(run_id) {
    if let Some(base_id) = run.base_run_id {
        let diff = diff_manager.compute_or_fetch(base_id, run.id).await?;
        emit(Event::AssessmentDiffReady { diff_id: diff.id });
        convergence_tracker.record(chain_id, &diff);
    }
}
```

**Exit**: after handoff cycle, UI receives diff event.

### S6 — UI: AssessmentDiff view (0.4 day)

Overlay or dedicated page:
```tsx
function AssessmentDiff({ diffId }) {
  const diff = useDiff(diffId);
  if (!diff) return <Loading />;
  return (
    <section className="assessment-diff">
      <VerdictDelta delta={diff.verdictDelta} />
      <DiffTabs diff={diff} />
    </section>
  );
}
```

VerdictDelta: side-by-side before/after verdict + arrow with direction glyph.

DiffTabs:
- Resolved (count badge green): findings gone, with resolution evidence.
- Persistent (count badge amber): still present.
- Regressed (count badge red): severity worsened.
- New (count badge info): newly discovered.

Each tab is a virtualized list of FindingCard-lite components with badges indicating category.

Integrates into AssessmentReport via "Compare with previous run" toggle.

**Exit**: all 4 categories render.

### S7 — Convergence banner (0.1 day)

If `diff.convergenceCounter >= 3`:
- Banner at top of AssessmentDiff: "Assessment stuck — no improvement over last 3 handoff cycles. Consider manual review."
- CTAs: Mark for review, Inspect handoff history, Escalate.

**Exit**: stuck banner visible after synthetic 3-stuck scenario.

### S8 — Perf (0.1 day)

Diff compute: < 100ms for runs with up to 5k findings. Uses HashMap lookups.

**Exit**: bench green.

## Testing

- Unit: diff compute across scenarios (all improved, all regressed, mixed).
- Convergence counter correctness.
- Integration: handoff → reassess → diff → UI.

## Exit criteria

- [ ] Diff compute correct.
- [ ] Convergence counter fires after 3 stuck.
- [ ] UI shows resolved/persistent/regressed/new distinctly.
- [ ] Verdict delta visible.
- [ ] Auto-trigger works after reassess.

## Risks

| Risk | Mitigation |
|---|---|
| Identity hash mismatch across runs (rewording) | Title normalization at emit; diff tolerates minor drift via `normalize_title` |
| Resolution evidence missing for "resolved" | Optional field; UI shows "no explicit resolution evidence" note |
| Convergence false positives (acceptable plateaus) | User can dismiss banner per chain |

## Related

- [`assessment-contract.md`](../../assessment-contract.md) §7
- Plan 26 — run manager
- Plan 27 — identity hash source
- Plan 34 — dispatch triggers reassess
