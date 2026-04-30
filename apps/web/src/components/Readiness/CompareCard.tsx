// Compared-to-last-run card — Stage J.
// Reuses the existing 4-bucket `computeDiff` from Phase 5 so the
// resolved/persistent/regressed/new counts on the report match the
// AssessmentDiff toggle elsewhere in the hub.

import { useEffect, useMemo } from 'react';
import { computeDiff } from '../../stores/assessmentDiff';
import { useAssessment, type Finding, type Run } from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { requestAssessmentDiff } from '../../domain/assessment/queries';

interface Props {
  run: Run;
  transport: TransportHandle | null;
}

export function CompareCard({ run, transport }: Props) {
  const allRuns = useAssessment((s) => s.runs);
  const runOrder = useAssessment((s) => s.runOrder);
  const findings = useAssessment((s) => s.findings);
  const sessionId = useSession((s) => s.sessionId);

  // Most-recent prior completed run of the same swarm.
  const priorRunId = useMemo<string | null>(() => {
    const idx = runOrder.indexOf(run.id);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const id = runOrder[i];
      if (!id) continue;
      const r = allRuns.get(id);
      if (r && r.swarm === run.swarm && r.status === 'completed') return id;
    }
    return null;
  }, [run.id, run.swarm, allRuns, runOrder]);
  const diffKey = priorRunId ? `${priorRunId}\x00${run.id}` : null;
  const cachedDiff = useAssessment((s) => (diffKey ? s.diffs.get(diffKey) : undefined));

  useEffect(() => {
    if (!priorRunId || cachedDiff || !transport || !sessionId) return;
    void requestAssessmentDiff(transport, sessionId, priorRunId, run.id).catch(() => {});
  }, [cachedDiff, transport, sessionId, priorRunId, run.id]);

  const diff = useMemo(() => {
    if (cachedDiff) return cachedDiff;
    if (!priorRunId) return null;
    const prevList: Finding[] = [];
    const nextList: Finding[] = [];
    for (const f of findings.values()) {
      if (f.run_id === priorRunId) prevList.push(f);
      else if (f.run_id === run.id) nextList.push(f);
    }
    return computeDiff(prevList, nextList);
  }, [cachedDiff, priorRunId, run.id, findings]);

  return (
    <div className="card">
      <div className="card-hd">
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-3)',
          }}
        >
          Compared to last run
        </div>
      </div>
      <div className="card-body" style={{ padding: '8px 14px 14px' }}>
        {!diff ? (
          <div className="muted" style={{ fontSize: 12.5 }}>
            No prior completed run for this family yet.
          </div>
        ) : (
          <>
            <Row tone="ok" label="Resolved" n={diff.counts.resolved} />
            <Row tone="warn" label="Persistent" n={diff.counts.persistent} />
            <Row tone="crit" label="Regressed" n={diff.counts.regressed} />
            <Row tone="info" label="New" n={diff.counts.new} />
          </>
        )}
      </div>
    </div>
  );
}

function Row({ tone, label, n }: { tone: string; label: string; n: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr',
        padding: '4px 0',
        fontSize: 12.5,
        borderBottom: '1px solid var(--line-soft)',
      }}
    >
      <span style={{ color: `var(--${tone})`, fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-sans)' }}>
        {n} finding{n === 1 ? '' : 's'}
      </span>
    </div>
  );
}
