// Verdict card for AssessmentReportDetail — Stage J.
// Big-letter verdict + 4-stat severity counts. Numbers are derived from the
// findings store, so they auto-update when new emit events arrive while the
// report stays open.

import type { Finding, Verdict } from '../../stores/assessment';

interface Props {
  verdict: Verdict | undefined;
  findings: Finding[];
}

const VERDICT_TONE: Record<Verdict, string> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'crit',
  unknown: 'info',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'Ready',
  warn: 'Conditional',
  fail: 'Blocked',
  unknown: 'Unknown',
};

export function VerdictCard({ verdict, findings }: Props) {
  const v: Verdict = verdict ?? 'unknown';
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  const blockers = counts.critical + counts.high;
  const warnings = counts.medium + counts.low;

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
          Verdict
        </div>
      </div>
      <div className="card-body" style={{ padding: '8px 14px 14px' }}>
        <div
          className={`verdict-big ${VERDICT_TONE[v]}`}
          style={{
            fontSize: 28,
            fontWeight: 650,
            color: `var(--${VERDICT_TONE[v]})`,
            lineHeight: 1.1,
          }}
        >
          {VERDICT_LABEL[v]}
        </div>
        <div
          className="muted"
          style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}
        >
          {blockers > 0
            ? `${blockers} blocker${blockers === 1 ? '' : 's'} must be resolved before this gate can pass.`
            : warnings > 0
              ? 'No blockers — recommended improvements only.'
              : 'No findings recorded.'}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginTop: 14,
          }}
        >
          <Stat n={counts.critical} label="Critical" tone="crit" />
          <Stat n={counts.high} label="High" tone="warn" />
          <Stat n={counts.medium} label="Medium" tone="info" />
          <Stat n={counts.low + counts.info} label="Low" tone="ink-3" />
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '6px 0',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-sunken)',
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 650,
          color: tone === 'ink-3' ? 'var(--ink-3)' : `var(--${tone})`,
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{label}</div>
    </div>
  );
}
