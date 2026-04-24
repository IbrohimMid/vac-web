// Approvals tab: pending tool-call list with approve/reject + inspector overlay.
// Shortcuts: `a` approve topmost, `A` approve all visible, `x` reject topmost.

import { useEffect } from 'react';
import { SeverityIcon, type Severity } from '../SeverityIcon';
import { useApprovals, type RiskLevel, type ToolCall } from '../../stores/approvals';
import { useOverlays } from '../../stores/overlays';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

const RISK_TO_SEVERITY: Record<RiskLevel, Severity> = {
  low: 'ok',
  medium: 'warn',
  high: 'error',
};

interface Props {
  transport: TransportHandle | null;
}

export function ApprovalsTab({ transport }: Props) {
  const order = useApprovals((s) => s.order);
  const pending = useApprovals((s) => s.pending);
  const sessionId = useSession((s) => s.sessionId);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    if (!transport || !sessionId) return;
    const prior = useApprovals.getState().pending.get(id);
    if (!prior || prior.state !== 'pending') return;
    useApprovals.getState().markDeciding(id);
    const cmd = decision === 'approved' ? 'approval.approve' : 'approval.reject';
    try {
      const ack = await transport.send(sessionId, cmd, { tool_call_id: id });
      if (!ack.ok) {
        // Rollback optimistic state; authoritative event won't arrive.
        useApprovals.getState().upsertPending({ ...prior });
      }
    } catch {
      useApprovals.getState().upsertPending({ ...prior });
    }
  };

  const approveAll = async () => {
    for (const id of order) await decide(id, 'approved');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (useOverlays.getState().stack.length > 0) return;
      const currentOrder = useApprovals.getState().order;
      if (currentOrder.length === 0) return;
      const top = currentOrder[currentOrder.length - 1];
      if (!top) return;
      if (e.key === 'a') {
        e.preventDefault();
        void decide(top, 'approved');
      } else if (e.key === 'A') {
        e.preventDefault();
        void approveAll();
      } else if (e.key === 'x') {
        e.preventDefault();
        void decide(top, 'rejected');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Deps intentionally limited: decide/approveAll capture `transport` + `sessionId`
    // which live in stable props/selectors; reading order via store inside handler
    // avoids re-registering on every pending-list mutation.
  }, [transport, sessionId]);

  if (order.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-2)' }}>
        No pending approvals.
        <div style={{ fontSize: 12, marginTop: 8 }}>
          Shortcuts: <kbd>a</kbd> approve · <kbd>A</kbd> approve all · <kbd>x</kbd> reject
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong>{order.length} pending</strong>
        <button onClick={approveAll} disabled={!transport} aria-label="Approve all">
          Approve all
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {order.map((id) => {
          const tc = pending.get(id);
          if (!tc) return null;
          return <ApprovalRow key={id} tc={tc} onDecide={decide} />;
        })}
      </ul>
    </div>
  );
}

function ApprovalRow({
  tc,
  onDecide,
}: {
  tc: ToolCall;
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const inspect = () => {
    useOverlays.getState().open('approval_inspector', { toolCallId: tc.id });
  };
  const busy = tc.state === 'deciding';
  return (
    <li
      style={{
        border: '1px solid var(--border-1, #2a2a2a)',
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <SeverityIcon severity={RISK_TO_SEVERITY[tc.risk]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{tc.tool}</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tc.summary || '(no summary)'}
        </div>
      </div>
      <button onClick={inspect} aria-label="Inspect">
        Inspect
      </button>
      <button onClick={() => onDecide(tc.id, 'approved')} disabled={busy} aria-label="Approve">
        Approve
      </button>
      <button onClick={() => onDecide(tc.id, 'rejected')} disabled={busy} aria-label="Reject">
        Reject
      </button>
    </li>
  );
}
