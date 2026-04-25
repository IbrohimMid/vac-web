// HandoffBuilder: pick findings → author tasks → preview pin → submit.
// Submission is `handoff.create` (author signature). Approval requires a
// *different* signer via the PacketDetail view (two-party rule).

import { useEffect, useMemo, useState } from 'react';
import { useAssessment, type Finding, type Severity } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

const SEV_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

interface Props {
  transport: TransportHandle | null;
}

export function HandoffBuilder({ transport }: Props) {
  const findings = useAssessment((s) => s.findings);
  const activeRunId = useAssessment((s) => s.activeRunId);
  const sessionId = useSession((s) => s.sessionId);

  // Pre-fill from the report-selection slice on mount; once consumed, the
  // slice is cleared so navigating back-and-forth doesn't keep re-applying
  // stale selection. The reportSelection store is the single source of truth
  // for "findings the user wants in a packet" — useAttachments stays out of
  // this domain.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = useAssessmentReport.getState().selectedFindingIds;
    return new Set(initial);
  });
  useEffect(() => {
    if (useAssessmentReport.getState().selectedFindingIds.size > 0) {
      useAssessmentReport.getState().clearSelection();
    }
    // Run only on mount; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [title, setTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [targetProfile, setTargetProfile] = useState('executor.code@1.0.0');
  const [policy, setPolicy] = useState<'strict' | 'lenient'>('strict');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runFindings = useMemo(() => {
    const list: Finding[] = [];
    for (const f of findings.values()) {
      if (activeRunId && f.run_id !== activeRunId) continue;
      if (SEV_ORDER[f.severity] < SEV_ORDER.medium) continue;
      list.push(f);
    }
    list.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
    return list;
  }, [findings, activeRunId]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!transport || !sessionId || !authorName.trim() || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const tasks = Array.from(selected).map((fid, i) => {
        const f = findings.get(fid);
        return {
          id: `t${i + 1}`,
          title: f?.title ?? 'Task',
          finding_ids: [fid],
          requires_approval_per_step: f?.severity === 'critical',
          constraint: f?.summary ?? '',
        };
      });
      const ack = await transport.send(sessionId, 'handoff.create', {
        title: title.trim() || `Handoff ${new Date().toISOString()}`,
        target_profile: targetProfile,
        author: authorName.trim(),
        policy,
        tasks,
      });
      if (!ack.ok) {
        setError(ack.error?.message ?? 'create failed');
      } else {
        setSelected(new Set());
        setTitle('');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (runFindings.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-2)' }}>
        No eligible findings (severity ≥ medium) in the active run.
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <h3 style={{ margin: '4px 0' }}>Build handoff packet</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <label>
          Title{' '}
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Author{' '}
          <input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="your name"
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Profile{' '}
          <select value={targetProfile} onChange={(e) => setTargetProfile(e.target.value)}>
            <option value="executor.code@1.0.0">executor.code@1.0.0</option>
          </select>
        </label>
        <label>
          Pin policy{' '}
          <select value={policy} onChange={(e) => setPolicy(e.target.value as 'strict' | 'lenient')}>
            <option value="strict">strict</option>
            <option value="lenient">lenient</option>
          </select>
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
        Select findings ({selected.size}):
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 280, overflow: 'auto' }}>
        {runFindings.map((f) => (
          <li
            key={f.id}
            style={{
              padding: 6,
              borderBottom: '1px solid var(--border-1, #2a2a2a)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(f.id)}
              onChange={() => toggle(f.id)}
              aria-label={`Select ${f.title}`}
            />
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{f.severity}</span>
            <span style={{ flex: 1 }}>{f.title}</span>
          </li>
        ))}
      </ul>
      {error && <div style={{ color: 'var(--sev-error)', marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={submit}
          disabled={!transport || submitting || !authorName.trim() || selected.size === 0}
        >
          {submitting ? '…' : 'Submit for approval'}
        </button>
      </div>
    </div>
  );
}
