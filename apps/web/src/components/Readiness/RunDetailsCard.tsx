// Single-family run details card for AssessmentReportDetail — Stage J.
//
// The card only reads fields that actually exist in the `Run` store today
// (id, swarm, status, started_at, finished_at, progress, verdict, score,
// validation). Validation now includes candidate received / rejected
// counters so the assessment report can surface rejected candidate audit
// data without inventing extra protocol rows.

import type { Run } from '../../stores/assessment';

export function RunDetailsCard({
  run,
  validatedFindings,
}: {
  run: Run;
  validatedFindings: number;
}) {
  const validation = run.validation;
  const checksTotal = run.progress.total;
  const checksDone = run.progress.completed;
  const rejectedSummary = summarizeRejectionReasons(validation?.rejection_reasons);
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
          Single-family run details
        </div>
      </div>
      <div className="card-body" style={{ padding: '8px 14px 14px' }}>
        <Row k="ID" v={<code>{run.id}</code>} mono />
        <Row k="Swarm" v={run.swarm.toUpperCase()} />
        <Row k="Status" v={run.status} />
        {(run.query_source || run.fallback_reason !== undefined) && (
          <Row
            k="Source"
            v={
              <span
                className="badge info mono"
                data-testid="assessment-provenance-chip"
                title={
                  run.query_source === 'index'
                    ? 'Assessment read served from the SQLite index.'
                    : run.fallback_reason !== undefined
                      ? `Assessment read fell back to the canonical event log (${run.fallback_reason}).`
                      : 'Assessment read fell back to the canonical event log.'
                }
              >
                {run.query_source === 'index' ? 'Source: index' : 'Source: event log fallback'}
              </span>
            }
          />
        )}
        <Row k="Started" v={run.started_at} mono />
        {run.finished_at && <Row k="Finished" v={run.finished_at} mono />}
        <Row k="Checks" v={`${checksDone} / ${checksTotal}`} />
        <Row
          k="Validated"
          v={`${validatedFindings} finding${validatedFindings === 1 ? '' : 's'}`}
        />
        <Row
          k="Candidates"
          v={`${validation?.received ?? 0} candidate${(validation?.received ?? 0) === 1 ? '' : 's'}`}
        />
        <Row
          k="Rejected"
          v={`${validation?.rejected ?? 0} candidate${(validation?.rejected ?? 0) === 1 ? '' : 's'}`}
        />
        {rejectedSummary && <Row k="Reasons" v={rejectedSummary} />}
        {run.verdict && <Row k="Verdict" v={run.verdict} />}
      </div>
    </div>
  );
}

function summarizeRejectionReasons(reasons?: Record<string, number>): string | null {
  const entries = Object.entries(reasons ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ');
}

function Row({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        padding: '4px 0',
        fontSize: 12.5,
        borderBottom: '1px solid var(--line-soft)',
      }}
    >
      <span style={{ color: 'var(--ink-3)' }}>{k}</span>
      <span
        style={
          mono
            ? { fontFamily: 'var(--font-mono)', fontSize: 12 }
            : { fontFamily: 'var(--font-sans)' }
        }
      >
        {v}
      </span>
    </div>
  );
}
