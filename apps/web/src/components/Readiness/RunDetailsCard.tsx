// Run details card for AssessmentReportDetail — Stage J.
//
// Per the audit-reviewed plan: only fields that actually exist in the
// `Run` store today (id, swarm, status, started_at, finished_at, progress,
// verdict, score). No fabricated `profile` / `repo` / `connectors` /
// `base_commit` / `snapshot_ttl` rows — those land if/when the protocol
// payload is extended upstream.

import type { Run } from '../../stores/assessment';

export function RunDetailsCard({ run }: { run: Run }) {
  const checksTotal = run.progress.total;
  const checksDone = run.progress.completed;
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
          Run details
        </div>
      </div>
      <div className="card-body" style={{ padding: '8px 14px 14px' }}>
        <Row k="ID" v={<code>{run.id}</code>} mono />
        <Row k="Swarm" v={run.swarm.toUpperCase()} />
        <Row k="Status" v={run.status} />
        <Row k="Started" v={run.started_at} mono />
        {run.finished_at && <Row k="Finished" v={run.finished_at} mono />}
        <Row k="Checks" v={`${checksDone} / ${checksTotal}`} />
        {run.verdict && <Row k="Verdict" v={run.verdict} />}
      </div>
    </div>
  );
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
