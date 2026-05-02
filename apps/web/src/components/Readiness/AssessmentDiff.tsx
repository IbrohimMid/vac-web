// 4-tab diff view comparing two runs of the same swarm.
// Resolved / persistent / regressed / new, keyed by identity_hash.

import { useEffect, useMemo, useState } from 'react';
import { computeDiff, type DiffBucket } from '../../stores/assessmentDiff';
import { useAssessment, queryFailureKey, type Finding } from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { reasonLabel, requestAssessmentDiff } from '../../domain/assessment/queries';

interface Props {
  prevRunId: string;
  nextRunId: string;
  transport: TransportHandle | null;
}

const BUCKET_LABEL: Record<DiffBucket, string> = {
  resolved: 'Resolved',
  persistent: 'Persistent',
  regressed: 'Regressed',
  new: 'New',
};

const BUCKET_COLOR: Record<DiffBucket, string> = {
  resolved: 'var(--sev-ok)',
  persistent: 'var(--text-2)',
  regressed: 'var(--sev-error)',
  new: 'var(--sev-warn)',
};

export function AssessmentDiff({ prevRunId, nextRunId, transport }: Props) {
  const findings = useAssessment((s) => s.findings);
  const cachedDiff = useAssessment((s) => s.diffs.get(`${prevRunId}\x00${nextRunId}`));
  const diffError = useAssessment((s) =>
    s.queryErrors.get(queryFailureKey('diff', `${prevRunId}\x00${nextRunId}`)),
  );
  const clearQueryFailure = useAssessment((s) => s.clearQueryFailure);
  const sessionId = useSession((s) => s.sessionId);

  useEffect(() => {
    if (cachedDiff || !transport || !sessionId) return;
    void requestAssessmentDiff(transport, sessionId, prevRunId, nextRunId).catch(() => {});
  }, [cachedDiff, transport, sessionId, prevRunId, nextRunId]);

  const retryDiff = () => {
    if (!transport || !sessionId) return;
    clearQueryFailure('diff', `${prevRunId}\x00${nextRunId}`);
    void requestAssessmentDiff(transport, sessionId, prevRunId, nextRunId).catch(() => {});
  };

  const diff = useMemo(() => {
    if (cachedDiff) return cachedDiff;
    const prev: Finding[] = [];
    const next: Finding[] = [];
    for (const f of findings.values()) {
      if (f.run_id === prevRunId) prev.push(f);
      else if (f.run_id === nextRunId) next.push(f);
    }
    return computeDiff(prev, next);
  }, [cachedDiff, findings, prevRunId, nextRunId]);

  const [tab, setTab] = useState<DiffBucket>('regressed');
  const visible = diff.entries.filter((e) => e.bucket === tab);

  return (
    <div data-testid="assessment-diff-view" style={shellStyle}>
      {diffError && !cachedDiff && (
        <div role="alert" style={errorBannerStyle}>
          <strong style={errorTitleStyle}>{reasonLabel(diffError.reason)}</strong>
          <span className="muted">{diffError.message}</span>
          <div style={spacerStyle} />
          <button
            className="btn xs"
            onClick={retryDiff}
            disabled={!transport || !sessionId}
          >
            Retry
          </button>
        </div>
      )}
      <header style={headerStyle}>
        {(Object.keys(BUCKET_LABEL) as DiffBucket[]).map((b) => (
          <button
            key={b}
            onClick={() => setTab(b)}
            aria-pressed={tab === b}
            style={{
              padding: '4px 10px',
              borderRadius: 14,
              border: `1px solid ${BUCKET_COLOR[b]}`,
              color: tab === b ? '#000' : BUCKET_COLOR[b],
              background: tab === b ? BUCKET_COLOR[b] : 'transparent',
              cursor: 'pointer',
            }}
          >
            {BUCKET_LABEL[b]} {diff.counts[b]}
          </button>
        ))}
      </header>
      {visible.length === 0 ? (
        <div style={emptyStyle}>Empty bucket.</div>
      ) : (
        <ul style={listStyle}>
          {visible.map((e) => {
            const f = e.next ?? e.prev;
            if (!f) return null;
            return (
              <li key={e.identity_hash} style={itemStyle}>
                <strong>{f.title}</strong>
                {e.bucket === 'regressed' && e.prev && e.next && (
                  <span style={severityStyle}>
                    {e.prev.severity} → {e.next.severity}
                  </span>
                )}
                <div style={metaStyle}>
                  <code>{e.identity_hash.slice(0, 12)}…</code> · {f.category}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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
const headerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};
const emptyStyle: React.CSSProperties = {
  color: 'var(--text-2)',
  fontSize: 13,
  padding: 8,
};
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 320,
  overflow: 'auto',
};
const itemStyle: React.CSSProperties = {
  padding: 6,
  borderBottom: '1px solid var(--line)',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const severityStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 11,
  color: 'var(--sev-error)',
};
const metaStyle: React.CSSProperties = {
  color: 'var(--text-2)',
  fontSize: 11,
};
