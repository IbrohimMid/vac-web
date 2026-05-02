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
      <div className="soft-empty">
        <strong>No eligible findings.</strong>
        <div>Run an assessment with medium-or-higher findings before building a handoff packet.</div>
      </div>
    );
  }

  const pinComputedByBridge = !draft.pin.worktree_digest.trim();
  const sourceRunCount = draft.source_run_ids.length;

  return (
    <div className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Build handoff packet</h3>
            <div className="screen-subtitle">Package validated findings, pin context, and generated tasks for executor handoff.</div>
          </div>
          <span className="badge">{selected.size} selected</span>
        </div>
      </header>
      <div className="handoff-form-grid">
        <label>
          Title{' '}
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Author{' '}
          <input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="your name"
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
      <div className="handoff-summary-grid">
        <section className="handoff-section">
          <h4 className="handoff-section-title">Pin preview</h4>
          <div className="kv-stack">
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
            <div className="panel-subtitle">
              Worktree digest is computed by the bridge when the draft is created.
            </div>
          )}
          {sourceRunCount > 1 && (
            <div className="handoff-note-warn">
              Selected findings span {sourceRunCount} runs; the draft pin uses the primary run metadata.
            </div>
          )}
        </section>
        <section className="handoff-section">
          <h4 className="handoff-section-title">Draft summary</h4>
          <div className="kv-stack">
            <div>source runs: <code>{draft.source_run_ids.length}</code></div>
            <div>accepted findings: <code>{draft.accepted_finding_ids.length}</code></div>
            <div>approval: <code>{draft.approval.required ? 'required' : 'optional'}</code></div>
            <div>two party: <code>{draft.approval.two_party ? 'yes' : 'no'}</code></div>
            <div>target: <code>{draft.target.executor_profile_id}</code></div>
            <div>created by: <code>{draft.created_by}</code></div>
          </div>
        </section>
      </div>
      <div className="panel-subtitle" style={{ margin: '10px 0 6px' }}>
        Select findings ({selected.size})
      </div>
      <ul className="handoff-finding-list">
        {runFindings.map((f) => {
          const carryover = isCarryover(f, activeRunId, selected);
          const fromOtherRun = activeRunId != null && f.run_id !== activeRunId;
          return (
            <li key={f.id} className="handoff-finding-row">
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={() => toggle(f.id)}
                aria-label={`Select ${f.title}`}
              />
              <span className="badge">{f.severity}</span>
              <span className="handoff-finding-title">{f.title}</span>
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
        <section className="handoff-section" style={{ marginTop: 10 }}>
          <h4 className="handoff-section-title">Generated task plan</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {draft.tasks.map((task) => (
              <details
                key={task.id}
                open={draft.tasks.length === 1}
              >
                <summary>
                  <strong>{task.title}</strong>{' '}
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    · {task.est_effort} · {task.evidence_refs.length} evidence ref
                    {task.evidence_refs.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div className="kv-stack" style={{ marginTop: 8 }}>
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
      {error && <div className="handoff-note-error">{error}</div>}
      <div className="screen-actions" style={{ marginTop: 10 }}>
        <button className="btn primary"
          onClick={submit}
          disabled={!transport || submitting || !authorName.trim() || selected.size === 0}
        >
          {submitting ? '…' : 'Submit for approval'}
        </button>
      </div>
    </div>
  );
}
