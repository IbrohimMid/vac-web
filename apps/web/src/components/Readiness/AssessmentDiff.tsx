// 4-tab diff view comparing two runs of the same swarm.
// Resolved / persistent / regressed / new, keyed by identity_hash.

import { useEffect, useMemo, useState } from 'react';
import { computeDiff, type DiffBucket } from '../../stores/assessmentDiff';
import { useAssessment, type Finding } from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { requestAssessmentDiff } from '../../domain/assessment/queries';

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
  const sessionId = useSession((s) => s.sessionId);

  useEffect(() => {
    if (cachedDiff || !transport || !sessionId) return;
    void requestAssessmentDiff(transport, sessionId, prevRunId, nextRunId).catch(() => {});
  }, [cachedDiff, transport, sessionId, prevRunId, nextRunId]);

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
    <div style={{ padding: 8 }}>
      <header style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
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
        <div style={{ color: 'var(--text-2)', padding: 12 }}>Empty bucket.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((e) => {
            const f = e.next ?? e.prev;
            if (!f) return null;
            return (
              <li
                key={e.identity_hash}
                style={{
                  padding: 6,
                  borderBottom: '1px solid var(--border-1, #2a2a2a)',
                  fontSize: 13,
                }}
              >
                <strong>{f.title}</strong>
                {e.bucket === 'regressed' && e.prev && e.next && (
                  <span style={{ marginLeft: 6, color: 'var(--sev-error)', fontSize: 11 }}>
                    {e.prev.severity} → {e.next.severity}
                  </span>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
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
