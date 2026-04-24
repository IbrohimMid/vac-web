// Detail view for a single packet: pin summary, tasks, signer form, dispatch.
// Two-party rule: approval requires a signer name distinct from the author.

import { useState } from 'react';
import { type Packet } from '../../stores/handoff';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

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
  const authorName = author?.name.trim();
  const approverTrim = approverName.trim();
  const canApprove =
    packet.status === 'pending_approval' &&
    approverTrim.length > 0 &&
    approverTrim !== authorName &&
    packet.signers.length < packet.required_signers;

  const approve = async () => {
    if (!transport || !sessionId) return;
    setErr(null);
    // Client-side self-sign guard (bridge enforces too). Trim both sides so
    // whitespace doesn't smuggle a duplicate signer past the check.
    if (approverTrim === authorName) {
      setErr('self-sign denied — approver must differ from author');
      return;
    }
    try {
      const ack = await transport.send(sessionId, 'handoff.approve', {
        packet_id: packet.id,
        approver: approverName.trim(),
        reason: approverReason.trim() || 'approved',
      });
      if (!ack.ok) setErr(ack.error?.message ?? 'approve failed');
    } catch (e) {
      setErr(String(e));
    }
  };

  const reject = async () => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'handoff.reject', {
        packet_id: packet.id,
        reason: approverReason.trim() || 'rejected',
      });
    } catch {
      /* ignore */
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
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
        profile: {packet.target_profile} · tasks: {packet.tasks.length} · pin:{' '}
        <code>{packet.pin.worktree_digest.slice(0, 12) || '(none)'}</code> @{' '}
        <code>{packet.pin.base_sha.slice(0, 12) || '(none)'}</code> · policy:{' '}
        {packet.pin.policy}
      </div>
      {packet.tasks.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {packet.tasks.map((t) => (
            <li
              key={t.id}
              style={{
                fontSize: 12,
                padding: '4px 0',
                borderBottom: '1px solid var(--border-1, #2a2a2a)',
              }}
            >
              <strong>{t.title}</strong>
              {t.requires_approval_per_step && (
                <span style={{ marginLeft: 6, color: 'var(--sev-warn)' }}>[per-step]</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
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
      {packet.status === 'pending_approval' && (
        <section style={{ marginTop: 8, padding: 6, background: 'var(--bg-2, #181818)', borderRadius: 4 }}>
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
            <button onClick={reject}>Reject</button>
          </div>
          {err && <div style={{ color: 'var(--sev-error)', fontSize: 12, marginTop: 4 }}>{err}</div>}
        </section>
      )}
      {packet.status === 'approved' && (
        <div style={{ marginTop: 8 }}>
          <button onClick={dispatch} disabled={dispatching}>
            {dispatching ? 'Dispatching…' : 'Dispatch to executor'}
          </button>
        </div>
      )}
      {packet.status === 'executing' && packet.executor_session_id && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>
          Executor session: <code>{packet.executor_session_id}</code>
        </div>
      )}
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

