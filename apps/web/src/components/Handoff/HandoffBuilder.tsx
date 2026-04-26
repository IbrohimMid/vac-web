// HandoffBuilder: pick findings → author tasks → preview pin → submit.
// Submission is `handoff.create` (author signature). Approval requires a
// *different* signer via the PacketDetail view (two-party rule).

import { useEffect, useMemo, useState } from 'react';
import { useAssessment, type Finding } from '../../stores/assessment';
import { useAssessmentReport } from '../../stores/assessmentReport';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import { buildHandoffDraft } from './handoffDraft';
import { isCarryover, visibleHandoffFindings } from './visibleFindings';

interface Props {
  transport: TransportHandle | null;
}

export function HandoffBuilder({ transport }: Props) {
  const findings = useAssessment((s) => s.findings);
  const runs = useAssessment((s) => s.runs);
  const evidence = useAssessment((s) => s.evidence);
  const activeRunId = useAssessment((s) => s.activeRunId);
  const sessionId = useSession((s) => s.sessionId);
  const projectRoot = useSession((s) => s.projectRoot);

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

  // Visible picker list = active-run medium+ ∪ currently-selected (any run,
  // any severity). Logic + tests live in visibleFindings.ts.
  const runFindings = useMemo(
    () => visibleHandoffFindings(findings.values(), activeRunId, selected),
    [findings, activeRunId, selected],
  );

  const selectedFindings = useMemo(
    () =>
      Array.from(selected)
        .map((id) => findings.get(id))
        .filter((f): f is Finding => f !== undefined),
    [findings, selected],
  );

  const draft = useMemo(
    () =>
      buildHandoffDraft({
        findings: selectedFindings,
        runs,
        evidence,
        title,
        authorName,
        targetProfile,
        policy,
        activeRunId,
      }),
    [activeRunId, authorName, evidence, findings, policy, runs, selectedFindings, targetProfile, title],
  );

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
      const ack = await transport.send(sessionId, 'handoff.create', draft);
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

  const pinComputedByBridge = !draft.pin.worktree_digest.trim();
  const sourceRunCount = draft.source_run_ids.length;

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
            <option value="executor.release@1.0.0">executor.release@1.0.0</option>
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
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <section style={{ border: '1px solid var(--border-1, #2a2a2a)', borderRadius: 6, padding: 10 }}>
          <strong>Pin preview</strong>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
            <div>
              repo ref: <code>{draft.pin.repo_ref || '(bridge will derive from project root)'}</code>
            </div>
            <div>
              base commit: <code>{draft.pin.base_commit_sha || '(bridge will derive from git)'}</code>
            </div>
            <div>
              worktree digest: <code>{pinComputedByBridge ? 'computed on submit' : draft.pin.worktree_digest}</code>
            </div>
            <div>
              assessment snapshot: <code>{draft.pin.assessment_snapshot_at}</code>
            </div>
            <div>
              expires: <code>{draft.pin.expires_at}</code>
            </div>
            <div>
              policy: <code>{draft.pin.invalidation_policy}</code>
              {' · '}
              repo drift: <code>{draft.pin.invalidate_on_repo_change ? 'on' : 'off'}</code>
            </div>
            <div>
              connector snapshots: <code>{draft.pin.connector_snapshots.length}</code>
            </div>
            <div>
              project root: <code>{projectRoot ?? '(unknown)'}</code>
            </div>
          </div>
          {pinComputedByBridge && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-2)' }}>
              Worktree digest is computed by the bridge when the draft is created.
            </div>
          )}
          {sourceRunCount > 1 && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--sev-warn)' }}>
              Selected findings span {sourceRunCount} runs; the draft pin uses the primary run metadata.
            </div>
          )}
        </section>
        <section style={{ border: '1px solid var(--border-1, #2a2a2a)', borderRadius: 6, padding: 10 }}>
          <strong>Draft summary</strong>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
            <div>source runs: <code>{draft.source_run_ids.length}</code></div>
            <div>accepted findings: <code>{draft.accepted_finding_ids.length}</code></div>
            <div>approval: <code>{draft.approval.required ? 'required' : 'optional'}</code></div>
            <div>two party: <code>{draft.approval.two_party ? 'yes' : 'no'}</code></div>
            <div>target: <code>{draft.target.executor_profile_id}</code></div>
            <div>created by: <code>{draft.created_by}</code></div>
          </div>
        </section>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', margin: '10px 0 6px' }}>
        Select findings ({selected.size}):
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflow: 'auto' }}>
        {runFindings.map((f) => {
          const carryover = isCarryover(f, activeRunId, selected);
          const fromOtherRun = activeRunId != null && f.run_id !== activeRunId;
          return (
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
              {carryover && (
                <span
                  className="badge"
                  title={
                    fromOtherRun
                      ? 'Carried over from another run'
                      : 'Below the default severity floor'
                  }
                  style={{ fontSize: 10, padding: '1px 6px' }}
                >
                  carryover
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {draft.tasks.length > 0 && (
        <section style={{ marginTop: 10 }}>
          <strong>Generated task plan</strong>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {draft.tasks.map((task) => (
              <details
                key={task.id}
                open={draft.tasks.length === 1}
                style={{
                  border: '1px solid var(--border-1, #2a2a2a)',
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <summary style={{ cursor: 'pointer' }}>
                  <strong>{task.title}</strong>{' '}
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    · {task.est_effort} · {task.evidence_refs.length} evidence ref
                    {task.evidence_refs.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)' }}>
                  <div>
                    rationale: <span style={{ color: 'var(--text-1)' }}>{task.rationale}</span>
                  </div>
                  <div>
                    evidence:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.evidence_refs.length > 0
                        ? task.evidence_refs.map((ref) => ref.id).join(', ')
                        : '(none)'}
                    </span>
                  </div>
                  <div>
                    touched paths:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.touches_paths.length > 0 ? task.touches_paths.join(', ') : '(bridge derived)'}
                    </span>
                  </div>
                  <div>
                    constraints:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.constraints.length > 0 ? task.constraints.join(' · ') : '(none)'}
                    </span>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
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
