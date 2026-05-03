// Approvals tab: pending tool-call list with approve/reject + inspector overlay.
// Shortcuts: `a` approve topmost, `A` approve all visible, `x` reject topmost.

import { useEffect } from 'react';
import { SeverityIcon, type Severity } from '../SeverityIcon';
import {
  useApprovals,
  type ApprovalRequest,
  type ApprovalResolution,
  type RiskLevel,
} from '../../stores/approvals';
import { useOverlays } from '../../stores/overlays';
import { useSession } from '../../stores/session';
import { affordanceFor } from '../../domain/capabilities/affordanceCatalog';
import type { TransportHandle } from '../../transport';

const RISK_TO_SEVERITY: Record<RiskLevel, Severity> = {
  low: 'ok',
  medium: 'warn',
  high: 'error',
};

interface Props {
  transport: TransportHandle | null;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function ApprovalsTab({ transport }: Props) {
  const pendingOrder = useApprovals((s) => s.pendingOrder);
  const resolvedOrder = useApprovals((s) => s.resolvedOrder);
  const pending = useApprovals((s) => s.pending);
  const resolved = useApprovals((s) => s.resolved);
  const sessionId = useSession((s) => s.sessionId);

  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => {
    if (!transport || !sessionId) return;
    const prior = useApprovals.getState().pending.get(approvalId);
    if (!prior || prior.state !== 'pending') return;
    useApprovals.getState().markDeciding(approvalId);
    const cmd = decision === 'approved' ? 'approval.approve' : 'approval.reject';
    try {
      const ack = await transport.send(sessionId, cmd, { approval_id: approvalId });
      if (!ack.ok) {
        // Rollback optimistic state; authoritative event won't arrive.
        useApprovals.getState().upsertPending({ ...prior });
      }
    } catch {
      useApprovals.getState().upsertPending({ ...prior });
    }
  };

  const approveAll = async () => {
    for (const id of pendingOrder) await decide(id, 'approved');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (useOverlays.getState().stack.length > 0) return;
      const currentOrder = useApprovals.getState().pendingOrder;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, sessionId]);

  if (pendingOrder.length === 0 && resolvedOrder.length === 0) {
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
    <div className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Approvals</h3>
            <div className="screen-subtitle">Review and approve tool calls before they execute against the local workspace.</div>
          </div>
          <span className="badge">{pendingOrder.length} pending</span>
        </div>
      </header>
      {pendingOrder.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <strong>{pendingOrder.length} pending</strong>
            {(() => {
              // Slice 33 follow-up: "Approve all" is frontend-owned (it loops
              // and dispatches `approval.respond` per row). Catalog gates the
              // surface on transport so disabled-copy stays consistent.
              const decision = affordanceFor('approvals.approve_all', {
                commandStatus: 'frontend_owned',
                hasTransport: !!transport,
                hasSessionId: false,
              });
              return (
                <button
                  onClick={approveAll}
                  disabled={!decision.enabled}
                  data-affordance-id={decision.affordanceId}
                  title={decision.disabledReason ?? undefined}
                  aria-label="Approve all"
                >
                  Approve all
                </button>
              );
            })()}
          </div>
          <ul className="soft-list panel-card">
            {pendingOrder.map((id) => {
              const tc = pending.get(id);
              if (!tc) return null;
              return <ApprovalRow key={id} tc={tc} onDecide={decide} />;
            })}
          </ul>
        </>
      )}

      {resolvedOrder.length > 0 && (
        <div style={{ marginTop: pendingOrder.length > 0 ? 16 : 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-2)',
              marginBottom: 6,
              padding: '4px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            Resolved approvals ({resolvedOrder.length})
          </div>
          <ul className="soft-list panel-card">
            {resolvedOrder.map((id) => {
              const item = resolved.get(id);
              if (!item) return null;
              return <ResolvedApprovalRow key={id} item={item} />;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  tc,
  onDecide,
}: {
  tc: ApprovalRequest;
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const inspect = () => {
    useOverlays.getState().open('approval_inspector', { approvalId: tc.approvalId });
  };
  const busy = tc.state === 'deciding';
  return (
    <li
      style={{
        border: '1px solid var(--line)',
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
        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          approval: {shortId(tc.approvalId)} · tool_call: {shortId(tc.toolCallId)} · src:{' '}
          {tc.sourceEventType}
        </div>
        {tc.options.length > 0 && (
          <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-2)' }}>
            options: {tc.options.map((opt) => opt.name).join(' · ')}
          </div>
        )}
      </div>
      <button onClick={inspect} aria-label="Inspect">
        Inspect
      </button>
      {(() => {
        // Slice 33 follow-up: per-row Approve/Reject buttons drive the
        // `approval.respond` command. The row is only mounted inside the
        // approvals tab when transport is live, so `hasTransport: true` is
        // a safe static assumption — local `busy` (deciding) still gates
        // double-clicks. Catalog provides the disabled tooltip if a future
        // refactor re-tags the command as not_wired.
        const decision = affordanceFor('approvals.decide', {
          commandStatus: 'implemented',
          hasTransport: true,
          hasSessionId: true,
        });
        const disabled = busy || !decision.enabled;
        return (
          <>
            <button
              onClick={() => onDecide(tc.approvalId, 'approved')}
              disabled={disabled}
              data-affordance-id={decision.affordanceId}
              title={decision.disabledReason ?? undefined}
              aria-label="Approve"
            >
              Approve
            </button>
            <button
              onClick={() => onDecide(tc.approvalId, 'rejected')}
              disabled={disabled}
              data-affordance-id={decision.affordanceId}
              title={decision.disabledReason ?? undefined}
              aria-label="Reject"
            >
              Reject
            </button>
          </>
        );
      })()}
    </li>
  );
}

function decisionColor(decision: ApprovalResolution['decision']): string {
  if (decision === 'approved') return 'var(--ok)';
  if (decision === 'rejected') return 'var(--crit)';
  return 'var(--warn)';
}

function decisionLabel(item: ApprovalResolution): string {
  const bits: string[] = [item.decision];
  if (item.optionId) bits.push(`option ${item.optionId}`);
  if (item.outcome && item.outcome !== item.decision) bits.push(`outcome ${item.outcome}`);
  return bits.join(' · ');
}

function ResolvedApprovalRow({ item }: { item: ApprovalResolution }) {
  return (
    <li
      style={{
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: 0.9,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: decisionColor(item.decision),
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{item.tool}</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{item.summary || '(no summary)'}</div>
        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          approval: {shortId(item.approvalId)} · tool_call: {shortId(item.toolCallId)} · src:{' '}
          {item.sourceEventType}
        </div>
        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-2)' }}>
          resolved: {decisionLabel(item)} · {item.resolvedAt}
        </div>
      </div>
    </li>
  );
}
