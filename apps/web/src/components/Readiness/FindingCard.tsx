// Finding card with severity glyph + evidence chips.
// Evidence preview fetched lazily via `assessment.fetch_evidence_preview`.

import { useMemo, useState } from 'react';
import { FreshnessBadge } from './FreshnessBadge';
import { SeverityIcon, type Severity as UISeverity } from '../SeverityIcon';
import {
  useAssessment,
  type EvidenceRef,
  type Finding,
  type Severity as FSeverity,
} from '../../stores/assessment';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

const SEV_TO_UI: Record<FSeverity, UISeverity> = {
  info: 'info',
  low: 'info',
  medium: 'warn',
  high: 'warn',
  critical: 'error',
};

interface Props {
  finding: Finding;
  transport: TransportHandle | null;
}

export function FindingCard({ finding, transport }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Subscribe to the evidence Map identity, then resolve refs via useMemo so
  // we don't hand Zustand a fresh array every render (selector equality).
  const evidenceMap = useAssessment((s) => s.evidence);
  const evidence = useMemo<EvidenceRef[]>(
    () =>
      finding.evidence_ids
        .map((id) => evidenceMap.get(id))
        .filter((e): e is EvidenceRef => e !== undefined),
    [finding.evidence_ids, evidenceMap],
  );
  const sessionId = useSession((s) => s.sessionId);

  const fetchPreview = async (id: string) => {
    if (!transport || !sessionId) return;
    const ev = useAssessment.getState().evidence.get(id);
    if (!ev || ev.preview !== undefined) return;
    try {
      await transport.send(sessionId, 'assessment.fetch_evidence_preview', { evidence_id: id });
    } catch {
      /* ignore */
    }
  };

  return (
    <article
      aria-label={finding.title}
      style={{
        border: '1px solid var(--border-1, #2a2a2a)',
        borderRadius: 6,
        padding: 10,
        marginBottom: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SeverityIcon severity={SEV_TO_UI[finding.severity]} />
        <strong style={{ flex: 1 }}>{finding.title}</strong>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
          {finding.category} · {Math.round(finding.confidence * 100)}%
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="Toggle details"
        >
          {expanded ? '−' : '+'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{finding.summary}</div>
      {evidence.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '6px 0 0 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {evidence.map(
            (e) => (
                <li
                  key={e.id}
                  onClick={() => fetchPreview(e.id)}
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    background: 'var(--bg-2, #222)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <FreshnessBadge evidence={e} />
                  {e.connector}/{e.label}
                </li>
              ),
          )}
        </ul>
      )}
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div>
            <strong>Check:</strong> {finding.check}
          </div>
          <div>
            <strong>Subject:</strong> {finding.subject}
          </div>
          <div>
            <strong>Identity:</strong>{' '}
            <code style={{ fontSize: 11 }}>{finding.identity_hash.slice(0, 16)}…</code>
          </div>
          {evidence.map(
            (e) =>
              e.preview && (
                <pre
                  key={e.id}
                  style={{
                    marginTop: 6,
                    padding: 6,
                    background: 'var(--bg-2, #111)',
                    borderRadius: 4,
                    maxHeight: 200,
                    overflow: 'auto',
                    fontSize: 11,
                  }}
                >
                  {e.preview}
                </pre>
              ),
          )}
        </div>
      )}
    </article>
  );
}
