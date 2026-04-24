# Plan 29 — Readiness Hub + AssessmentReport UI

**Phase**: 4 · **Depends on**: Plans 26, 27, 28 · **Blocks**: Phase 4 exit · **Est**: 2.5 days

## Goal

The surfaces users actually interact with for assessment: the Readiness Hub showing scorecards for all families, and the detailed AssessmentReport view showing findings with evidence and the CTA to build a handoff.

## Why this is hard

Findings can scale to thousands. Virtualization + filter + expand + evidence preview must all coexist without jank. The scorecard view must feel dashboard-quality: compact, glanceable, actionable.

## Scope

### In
- Readiness Hub page: Technical / Product / UX / Release / Ops scorecards.
- AssessmentReport component.
- Finding list (virtualized, filtered, sorted).
- FindingCard with evidence chips + fix preview.
- Evidence preview overlay.
- Progress streaming.
- "Create handoff from selected" flow.

### Out
- AssessmentDiff UI (Plan 35).
- HandoffBuilder (Plan 33).

## Deliverables

```
apps/web/src/
├── components/
│   └── Workbench/
│       ├── ReadinessHub/
│       │   ├── ReadinessHub.tsx
│       │   ├── Scorecard.tsx
│       │   └── VerdictBadge.tsx
│       ├── AssessmentReport/
│       │   ├── AssessmentReport.tsx
│       │   ├── ReportHeader.tsx
│       │   ├── FindingsList.tsx
│       │   ├── FindingCard.tsx
│       │   ├── EvidenceChip.tsx
│       │   ├── EvidencePreview.tsx    # overlay body
│       │   ├── FilterBar.tsx
│       │   └── SelectionBar.tsx
├── stores/assessment.ts
├── domain/assessment/
│   ├── handlers.ts
│   └── filters.ts
```

## Stages

### S1 — Store (0.2 day)

```ts
interface AssessmentSlice {
  runs: Map<RunId, AssessmentRun>;
  activeRunId: RunId | null;
  progressByRun: Map<RunId, Progress>;
  selectedFindings: Set<FindingId>;
  filter: FindingFilter;
  openRun(id: RunId): void;
  closeRun(id: RunId): void;
  selectFinding(id: FindingId): void;
  clearSelection(): void;
  applyFilter(f: FindingFilter): void;
}
```

**Exit**: reducers tested.

### S2 — Event handlers (0.1 day)

```ts
queue.on('assessment.started', ...);
queue.on('assessment.progress', (ev) => progressStore.update(ev));
queue.on('assessment.finding_added', (ev) => upsertFinding(ev.payload.finding));
queue.on('assessment.completed', (ev) => finalizeRun(ev));
queue.on('assessment.failed', ...);
queue.on('assessment.evidence_stale_detected', (ev) => markStale(ev));
```

**Exit**: events drive store updates correctly.

### S3 — Readiness Hub (0.4 day)

```tsx
function ReadinessHub() {
  const scorecards = useScorecards();   // derived: latest run per family
  return (
    <section className="readiness-hub">
      <h1>Readiness</h1>
      <div className="scorecard-grid">
        <Scorecard kind="technical"  run={scorecards.technical} />
        <Scorecard kind="product"    run={scorecards.product} />
        <Scorecard kind="ux"         run={scorecards.ux} />
        <Scorecard kind="release"    run={scorecards.release} />
        <Scorecard kind="ops"        run={scorecards.ops} />
      </div>
      <RunAllButton />
    </section>
  );
}

function Scorecard({ kind, run }) {
  if (!run) return <EmptyCard kind={kind} />;
  return (
    <article className="scorecard" data-verdict={run.verdict.status}>
      <header>
        <h2>{labelFor(kind)}</h2>
        <VerdictBadge verdict={run.verdict} />
      </header>
      <Stats blockers={run.counts.blockers} warnings={run.counts.warnings} />
      <footer>
        <time>ran {timeAgo(run.completed_at)}</time>
        <button onClick={() => rerun(kind)}>Run again</button>
        <button onClick={() => openReport(run.id)}>Open report</button>
      </footer>
    </article>
  );
}
```

"Run All" → spawns all families in parallel.

Card click → opens AssessmentReport as split-pane or overlay (responsive).

**Exit**: Hub shows 5 cards; run CTA works.

### S4 — AssessmentReport + ReportHeader (0.3 day)

```tsx
function AssessmentReport({ runId }) {
  const run = useAssessment(s => s.runs.get(runId));
  if (!run) return <Loading />;
  return (
    <article className="assessment-report">
      <ReportHeader run={run} />
      <FilterBar />
      <FindingsList runId={runId} />
      <SelectionBar runId={runId} />
    </article>
  );
}

function ReportHeader({ run }) {
  return (
    <header>
      <h1>{labelFor(run.type)}</h1>
      <VerdictBadge verdict={run.verdict} />
      <dl>
        <dt>Started</dt><dd>{formatTime(run.started_at)}</dd>
        <dt>Scope</dt><dd>{run.scope.repo_ref}</dd>
        <dt>Depth</dt><dd>{run.scope.depth}</dd>
      </dl>
      <FreshnessMeter run={run} />
      {run.status === 'running' && <ProgressBar runId={run.id} />}
    </header>
  );
}
```

FreshnessMeter: % of evidence fresh vs stale, with refresh CTA if stale-hard present.

**Exit**: header renders all states (running/completed/failed).

### S5 — FindingsList virtualized (0.3 day)

```tsx
function FindingsList({ runId }) {
  const run = useAssessment(s => s.runs.get(runId));
  const filter = useAssessment(s => s.filter);
  const findings = useMemo(() => filterFindings(run.findings, filter), [run.findings, filter]);
  const virtualizer = useVirtualizer({
    count: findings.length,
    estimateSize: () => 150,
    getScrollElement: ...,
    overscan: 5,
  });
  return (
    <div ref={scrollRef} className="findings-list">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(v => (
          <div key={v.key} style={{ transform: `translateY(${v.start}px)` }}>
            <FindingCard finding={findings[v.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

Dynamic height: finding expanded state changes height; virtualizer measures dynamically.

Sort: by severity desc, then confidence desc.

**Exit**: 10k findings list scrolls at 60fps (bench:findings).

### S6 — FindingCard (0.4 day)

```tsx
function FindingCard({ finding }) {
  const [expanded, setExpanded] = useState(false);
  const selected = useAssessment(s => s.selectedFindings.has(finding.id));
  return (
    <article className="finding-card" data-severity={finding.severity}>
      <header>
        <Checkbox checked={selected} onChange={() => toggleSelect(finding.id)} />
        <SeverityIcon severity={finding.severity} />
        <h3>{finding.title}</h3>
        <ConfidenceBar value={finding.confidence} />
      </header>
      <p className="rationale">{finding.description}</p>
      <div className="evidence-row">
        {finding.evidence.map(ev => <EvidenceChip key={ev.id} evidence={ev} />)}
      </div>
      {expanded && <SuggestedFix fix={finding.suggested_fix} />}
      <button onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : 'Details'}</button>
    </article>
  );
}
```

Memo: pure on `finding.id + severity + selected`. Re-renders only on finding mutation.

**Exit**: cards render correctly; expand works; no cross-card rerender.

### S7 — EvidenceChip + preview (0.3 day)

```tsx
function EvidenceChip({ evidence }) {
  const freshness = evaluateFreshness(evidence);
  return (
    <button
      className="evidence-chip"
      data-kind={evidence.kind}
      data-freshness={freshness}
      onClick={() => openEvidencePreview(evidence)}
    >
      <KindIcon kind={evidence.kind} />
      <span>{shortLabel(evidence)}</span>
      {freshness !== 'fresh' && <FreshnessBadge state={freshness} />}
    </button>
  );
}
```

Preview: overlay with:
- File: code excerpt with syntax highlight + line range pointer.
- Commit: commit info + diff.
- PR: title + description + checks + changed files.
- Doc: rendered content (sanitized).
- Screenshot: image.
- Metric: plot.
- Log: formatted log lines.

Preview fetches lazily on open.

**Exit**: click chip → preview; different kinds render correctly.

### S8 — Filter + sort bar (0.2 day)

FilterBar controls:
- Severity multi-select.
- Category multi-select.
- Confidence threshold slider.
- Staleness toggle (show fresh only / include stale).
- Full-text search.
- Sort dropdown.

Filters applied in selector (memoized); fast on 10k findings.

**Exit**: filtering interactive, < 100ms response.

### S9 — Selection + CTA (0.1 day)

SelectionBar at bottom when selectedFindings.size > 0:
- "N findings selected"
- "Create handoff from selection" (triggers handoff_builder overlay — Plan 33).
- "Clear selection".

Findings with stale-hard evidence disabled for selection (cannot proceed); tooltip explains.

**Exit**: CTA routes to handoff builder.

### S10 — Perf bench (0.1 day)

`bench:findings` per `perf-test-plan.md §3.4`.

**Exit**: passes.

## Testing

- Unit: filter + sort.
- Integration: full run → hub → report.
- Perf bench.

## Exit criteria

- [ ] Hub shows 5 scorecards, live updates.
- [ ] Report virtualized at 10k findings.
- [ ] Evidence preview for all kinds.
- [ ] Filter + sort < 100ms.
- [ ] Create handoff CTA routes correctly.

## Risks

| Risk | Mitigation |
|---|---|
| Scorecard confusing if no runs yet | Empty state with "Run your first assessment" CTA |
| Evidence preview large payload | Lazy + cap + collapse |
| Dynamic height causes jump during expand | Measure + smooth transition |

## Related

- [`assessment-contract.md`](../../assessment-contract.md)
- [`evidence-freshness.md`](../../evidence-freshness.md)
- Plan 30 — Gate system consumes scorecards
- Plan 33 — Handoff builder consumes selection
