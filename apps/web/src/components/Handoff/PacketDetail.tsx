// Detail view for a single packet: pin summary, tasks, signer form, dispatch.
// Two-party rule: approval requires a signer name distinct from the author.

import { useState } from 'react';
import { type Packet } from '../../stores/handoff';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

const canonicalName = (value: string | undefined) => (value ?? '').trim().toLocaleLowerCase();
const stringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

interface Props {
  packet: Packet;
  transport: TransportHandle | null;
}

export function PacketDetail({ packet, transport }: Props) {
  const sessionId = useSession((s) => s.sessionId);
  const [approverName, setApproverName] = useState('');
  const [approverReason, setApproverReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const author = packet.signers.find((s) => s.role === 'author');
  const authorActorId = canonicalName(author?.name);
  const approverTrim = approverName.trim();
  const approverActorId = canonicalName(approverName);
  const signerActorIds = new Set(packet.signers.map((s) => canonicalName(s.name)));
  const canApprove =
    packet.status === 'pending_approval' &&
    approverTrim.length > 0 &&
    approverActorId !== authorActorId &&
    !signerActorIds.has(approverActorId) &&
    packet.signers.length < packet.required_signers;
  const canReject =
    packet.status === 'pending_approval' &&
    approverTrim.length > 0 &&
    !!transport &&
    !!sessionId;
  const pinReady =
    packet.pin.repo_ref.trim().length > 0 &&
    packet.pin.base_commit_sha.trim().length > 0 &&
    packet.pin.worktree_digest.trim().length > 0 &&
    packet.pin.assessment_snapshot_at.trim().length > 0 &&
    packet.pin.expires_at.trim().length > 0;
  const executionSessionId = packet.execution_session_id ?? packet.executor_session_id;
  const executionProgressEntries = Object.values(packet.execution_progress ?? {});
  const executionOutcome =
    packet.execution_outcome &&
    typeof packet.execution_outcome === 'object' &&
    !Array.isArray(packet.execution_outcome)
      ? (packet.execution_outcome as Record<string, unknown>)
      : undefined;
  const executionOutcomeStatus = stringValue(executionOutcome?.status, packet.status);
  const executionOutcomeCompleted = stringArray(executionOutcome?.tasks_completed);
  const executionOutcomeFailed = stringArray(executionOutcome?.tasks_failed);
  const executionOutcomeSummary = stringValue(executionOutcome?.changeset_summary);
  const executionOutcomeReassessment = stringValue(executionOutcome?.reassessment_run_id);
  const canDispatch = packet.status === 'approved' && pinReady;

  const approve = async () => {
    if (!transport || !sessionId) return;
    setErr(null);
    // Client-side self-sign guard mirrors the bridge. Canonicalize so
    // whitespace and case variants cannot sneak through the local affordance.
    if (approverActorId === authorActorId) {
      setErr('self-sign denied — approver must differ from author');
      return;
    }
    try {
      const ack = await transport.send(sessionId, 'handoff.approve', {
        packet_id: packet.id,
        approver: approverTrim,
        reason: approverReason.trim() || 'approved',
      });
      if (!ack.ok) setErr(ack.error?.message ?? 'approve failed');
    } catch (e) {
      setErr(String(e));
    }
  };

  const reject = async () => {
    if (!transport || !sessionId) return;
    setErr(null);
    try {
      const ack = await transport.send(sessionId, 'handoff.reject', {
        packet_id: packet.id,
        rejector: approverTrim,
        reason: approverReason.trim() || 'rejected',
      });
      if (!ack.ok) setErr(ack.error?.message ?? 'reject failed');
    } catch (e) {
      setErr(String(e));
    }
  };

  const dispatch = async () => {
    if (!transport || !sessionId || dispatching) return;
    setDispatching(true);
    try {
      await transport.send(sessionId, 'handoff.dispatch_local', { packet_id: packet.id });
    } catch {
      /* ignore */
    } finally {
      setDispatching(false);
    }
  };

  return (
    <section
      style={{
        border: '1px solid var(--border-1, #2a2a2a)',
        borderRadius: 6,
        padding: 12,
        marginTop: 8,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ flex: 1 }}>{packet.title}</strong>
        <StatusPill status={packet.status} />
      </header>
      {packet.summary && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{packet.summary}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        created by: <code>{packet.created_by}</code> · created at: <code>{packet.created_at}</code>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        target: {packet.target.executor_profile_id} · kind: {packet.target.kind} · source runs:{' '}
        {packet.source_run_ids.length} · accepted findings: {packet.accepted_finding_ids.length}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        pin: <code>{packet.pin.repo_ref || '(none)'}</code> @{' '}
        <code>{packet.pin.base_commit_sha.slice(0, 12) || '(none)'}</code> · digest:{' '}
        <code>{packet.pin.worktree_digest.slice(0, 12) || '(none)'}</code> · policy:{' '}
        {packet.pin.invalidation_policy}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        snapshot: <code>{packet.pin.assessment_snapshot_at}</code> · expires:{' '}
        <code>{packet.pin.expires_at}</code> · repo drift:{' '}
        {packet.pin.invalidate_on_repo_change ? 'on' : 'off'} · connector snapshots:{' '}
        {packet.pin.connector_snapshots.length}
      </div>
      {!pinReady && (
        <div style={{ marginTop: 6, color: 'var(--sev-warn)', fontSize: 12 }}>
          Pin is incomplete. Dispatch stays disabled until the packet carries a complete pin.
        </div>
      )}
      {packet.tasks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <strong>Tasks ({packet.tasks.length})</strong>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {packet.tasks.map((task) => (
              <details
                key={task.id}
                open={packet.tasks.length === 1}
                style={{
                  fontSize: 12,
                  padding: 8,
                  border: '1px solid var(--border-1, #2a2a2a)',
                  borderRadius: 6,
                }}
              >
                <summary style={{ cursor: 'pointer' }}>
                  <strong>{task.title}</strong>{' '}
                  <span style={{ color: 'var(--text-2)' }}>
                    · {task.est_effort} · {task.evidence_refs.length} evidence ref
                    {task.evidence_refs.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div style={{ marginTop: 6, color: 'var(--text-2)' }}>
                  <div>
                    rationale: <span style={{ color: 'var(--text-1)' }}>{task.rationale}</span>
                  </div>
                  <div>
                    source findings:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.source_finding_ids.length > 0
                        ? task.source_finding_ids.join(', ')
                        : '(none)'}
                    </span>
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
                      {task.touches_paths.length > 0 ? task.touches_paths.join(', ') : '(none)'}
                    </span>
                  </div>
                  <div>
                    constraints:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.constraints.length > 0 ? task.constraints.join(' · ') : '(none)'}
                    </span>
                  </div>
                  <div>
                    risk notes:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.risk_notes.length > 0 ? task.risk_notes.join(' · ') : '(none)'}
                    </span>
                  </div>
                  <div>
                    rollback:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.rollback_steps.length > 0 ? task.rollback_steps.join(' · ') : '(none)'}
                    </span>
                  </div>
                  <div>
                    depends on:{' '}
                    <span style={{ color: 'var(--text-1)' }}>
                      {task.depends_on.length > 0 ? task.depends_on.join(', ') : '(none)'}
                    </span>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <strong>Approval</strong>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          required: {packet.approval.required ? 'yes' : 'no'} · two party:{' '}
          {packet.approval.two_party ? 'yes' : 'no'} · roles:{' '}
          {packet.approval.required_roles.length > 0
            ? packet.approval.required_roles.join(', ')
            : '(none)'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
          approvers:{' '}
          {packet.approval.approvers.length > 0 ? packet.approval.approvers.join(', ') : '(none)'}
          {packet.approval.approved_at && (
            <>
              {' '}
              · approved at <code>{packet.approval.approved_at}</code>
            </>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <strong>
          Signers ({packet.signers.length}/{packet.required_signers})
        </strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>
          {packet.signers.map((s) => (
            <li key={s.name} style={{ fontSize: 12 }}>
              {s.role}: {s.name} · {s.signed_at}
              {s.reason && <span style={{ color: 'var(--text-2)' }}> — {s.reason}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ marginTop: 10 }}>
        <strong>State history</strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>
          {packet.state_history.map((entry, index) => (
            <li key={`${entry.state}-${entry.at}-${index}`} style={{ fontSize: 12 }}>
              {entry.state} · <code>{entry.at}</code>
              {entry.by && <span> · {entry.by}</span>}
              {entry.reason && <span style={{ color: 'var(--text-2)' }}> — {entry.reason}</span>}
            </li>
          ))}
        </ul>
      </div>
      {packet.status === 'pending_approval' && (
        <section
          style={{ marginTop: 8, padding: 6, background: 'var(--bg-2, #181818)', borderRadius: 4 }}
        >
          <strong style={{ fontSize: 12 }}>Approve</strong>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              placeholder="approver name (≠ author)"
              aria-label="Approver name"
              style={{ flex: 1 }}
            />
            <input
              value={approverReason}
              onChange={(e) => setApproverReason(e.target.value)}
              placeholder="reason"
              aria-label="Approver reason"
              style={{ flex: 2 }}
            />
            <button onClick={approve} disabled={!canApprove}>
              Approve
            </button>
            <button onClick={reject} disabled={!canReject}>
              Reject
            </button>
          </div>
          {err && <div style={{ color: 'var(--sev-error)', fontSize: 12, marginTop: 4 }}>{err}</div>}
        </section>
      )}
      {packet.status === 'approved' && (
        <div style={{ marginTop: 8 }}>
          <button onClick={dispatch} disabled={dispatching || !canDispatch || !transport || !sessionId}>
            {dispatching ? 'Dispatching…' : 'Dispatch to executor'}
          </button>
          {!pinReady && (
            <div style={{ marginTop: 4, color: 'var(--sev-warn)', fontSize: 12 }}>
              Dispatch is blocked until the pin is complete.
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <strong>Execution</strong>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          status: <code>{packet.status}</code>
          {executionSessionId && (
            <>
              {' '}
              · executor session: <code>{executionSessionId}</code>
            </>
          )}
        </div>
        {packet.status === 'dispatched' && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)' }}>
            Executor session is being prepared...
          </div>
        )}
        {packet.status === 'executing' && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)' }}>
            Executor is running the packet tasks.
          </div>
        )}
        {executionProgressEntries.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong style={{ fontSize: 12 }}>Task progress</strong>
            <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>
              {executionProgressEntries.map((progress) => (
                <li key={progress.task_id} style={{ fontSize: 12, marginBottom: 4 }}>
                  <code>{progress.task_id}</code> · {progress.status} · {progress.completed}/{progress.total}
                  {progress.message && (
                    <span style={{ color: 'var(--text-2)' }}> — {progress.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(packet.status === 'completed' || packet.status === 'failed' || executionOutcome) && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)' }}>
            outcome: <code>{executionOutcomeStatus}</code>
            {executionOutcomeCompleted.length > 0 && (
              <>
                {' '}
                · completed: {executionOutcomeCompleted.join(', ')}
              </>
            )}
            {executionOutcomeFailed.length > 0 && (
              <>
                {' '}
                · failed: {executionOutcomeFailed.join(', ')}
              </>
            )}
            {executionOutcomeSummary && (
              <>
                {' '}
                · summary: {executionOutcomeSummary}
              </>
            )}
            {executionOutcomeReassessment && (
              <>
                {' '}
                · reassessment: <code>{executionOutcomeReassessment}</code>
              </>
            )}
          </div>
        )}
        {packet.status === 'completed' && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--sev-ok)' }}>
            Execution completed. Reassessment can run next.
          </div>
        )}
        {packet.status === 'failed' && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--sev-error)' }}>
            Execution failed. Review the failed tasks and rollback notes.
          </div>
        )}
      </div>
      {packet.status === 'invalidated' && (
        <div style={{ marginTop: 8, color: 'var(--sev-error)', fontSize: 12 }}>
          Invalidated — pin drift detected. Create a replacement packet from the fresh worktree.
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: Packet['status'] }) {
  const color =
    status === 'approved' || status === 'completed'
      ? 'var(--sev-ok)'
      : status === 'rejected' || status === 'invalidated' || status === 'failed' || status === 'expired'
        ? 'var(--sev-error)'
        : status === 'pending_approval'
          ? 'var(--sev-warn)'
          : 'var(--text-2)';
  return (
    <span
      style={{
        fontSize: 11,
        padding: '1px 6px',
        border: `1px solid ${color}`,
        color,
        borderRadius: 10,
      }}
    >
      {status}
    </span>
  );
}
