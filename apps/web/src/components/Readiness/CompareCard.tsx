// Compared-to-last-run card — Stage J.
// Reuses the existing 4-bucket `computeDiff` from Phase 5 so the
// resolved/persistent/regressed/new counts on the report match the
// AssessmentDiff toggle elsewhere in the hub.

import { useEffect, useMemo } from 'react';
import { computeDiff } from '../../stores/assessmentDiff';
import { useAssessment, queryFailureKey, type Finding, type Run } from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { reasonLabel, requestAssessmentDiff } from '../../domain/assessment/queries';

interface Props {
  run: Run;
  transport: TransportHandle | null;
}

export function CompareCard({ run, transport }: Props) {
  const allRuns = useAssessment((s) => s.runs);
  const runOrder = useAssessment((s) => s.runOrder);
  const findings = useAssessment((s) => s.findings);
  const queryErrors = useAssessment((s) => s.queryErrors);
  const clearQueryFailure = useAssessment((s) => s.clearQueryFailure);
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
  const diffError = diffKey ? queryErrors.get(queryFailureKey('diff', diffKey)) : undefined;

  const retryDiff = () => {
    if (!priorRunId || !transport || !sessionId) return;
    clearQueryFailure('diff', `${priorRunId}\x00${run.id}`);
    void requestAssessmentDiff(transport, sessionId, priorRunId, run.id).catch(() => {});
  };

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
        <div style={headerStyle}>Compared to last run</div>
      </div>
      <div className="card-body" style={bodyStyle}>
        {diffError && (
          <div role="alert" style={errorBannerStyle}>
            <strong style={errorTitleStyle}>
              {reasonLabel(diffError.reason)}
            </strong>
            <span className="muted" style={spacerStyle}>
              {diffError.message}
            </span>
            <button
              className="btn xs"
              onClick={retryDiff}
              disabled={!transport || !sessionId || !priorRunId}
            >
              Retry
            </button>
          </div>
        )}
        {!diff ? (
          <div className="muted" style={mutedStyle}>
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
    <div style={rowStyle}>
      <span style={{ color: `var(--${tone})`, fontWeight: 500 }}>{label}</span>
      <span style={countStyle}>
        {n} finding{n === 1 ? '' : 's'}
      </span>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: 0.2,
  color: 'var(--text-2)',
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '6px 10px',
  border: '1px solid var(--sev-error)',
  borderRadius: 6,
  fontSize: 12,
  marginBottom: 6,
};
const errorTitleStyle: React.CSSProperties = { color: 'var(--sev-error)' };
const spacerStyle: React.CSSProperties = { flex: 1 };
const mutedStyle: React.CSSProperties = { fontSize: 12.5 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '2px 0',
  fontSize: 13,
};
const countStyle: React.CSSProperties = { color: 'var(--text-2)' };
