// Pending promotion approvals queue (Slice #6 / ADR-0004).
//
// Renders the in-memory bridge queue published via
// extensions.approvals_list_response. Each pending row exposes an Approve
// button that calls extensions.approve_promotion. The bridge enforces that
// the approver session must differ from the requester session/profile, so a
// session viewing its own pending request will see the call refused with
// `extensions.same_operator`.

import { type CSSProperties } from 'react';
import { useExtensions } from '../../../stores/extensions';
import {
  tierLabel,
  type PromotionApprovalRequest,
} from '../../../domain/extensions/types';
import type { TransportHandle } from '../../../transport';
import { useSession } from '../../../stores/session';

interface Props {
  transport: TransportHandle | null;
}

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 16,
};
const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
};
const H3_STYLE: CSSProperties = { margin: 0, fontSize: 14 };
const TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};
const TH_STYLE: CSSProperties = { textAlign: 'left' };

function shortId(id: string): string {
  return id.length > 16 ? id.slice(0, 8) + '\u2026' + id.slice(-4) : id;
}

function approverDisabledReason(
  request: PromotionApprovalRequest,
  currentSessionId: string | null,
  hasTransport: boolean,
): string | null {
  if (!hasTransport) return 'Transport not connected.';
  if (!currentSessionId) return 'No active session.';
  if (request.requested_by_session_id === currentSessionId) {
    return 'Cannot approve your own request from the same session.';
  }
  return null;
}

export function PendingApprovals({ transport }: Props) {
  const approvalsOrder = useExtensions((s) => s.approvalsOrder);
  const approvals = useExtensions((s) => s.approvals);
  const approvalsStatus = useExtensions((s) => s.approvalsStatus);
  const approvalsError = useExtensions((s) => s.approvalsError);
  const approvePromotion = useExtensions((s) => s.approvePromotion);
  const sessionId = useSession((s) => s.sessionId);

  const visible = approvalsOrder
    .map((id) => approvals.get(id))
    .filter(
      (r): r is PromotionApprovalRequest => !!r && r.status === 'pending',
    );

  if (
    visible.length === 0 &&
    approvalsStatus !== 'error' &&
    approvalsStatus !== 'loading'
  ) {
    return null;
  }

  return (
    <section
      data-testid="pending-approvals"
      aria-label="Pending promotion approvals"
      style={SECTION_STYLE}
    >
      <div style={HEADER_ROW_STYLE}>
        <h3 style={H3_STYLE}>Pending promotion approvals</h3>
        <span className="muted">{visible.length} pending</span>
      </div>
      {approvalsStatus === 'error' && approvalsError && (
        <div
          role="alert"
          className="badge crit"
          data-testid="pending-approvals-error"
        >
          {approvalsError}
        </div>
      )}
      {approvalsStatus === 'loading' && visible.length === 0 && (
        <div className="muted" data-testid="pending-approvals-loading">
          Loading approvals…
        </div>
      )}
      {visible.length > 0 && (
        <table className="data-table" style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Request</th>
              <th style={TH_STYLE}>Extension</th>
              <th style={TH_STYLE}>Target tier</th>
              <th style={TH_STYLE}>Requested by</th>
              <th style={TH_STYLE}>Created</th>
              <th style={TH_STYLE}>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((request) => {
              const disabledReason = approverDisabledReason(
                request,
                sessionId,
                !!transport,
              );
              return (
                <tr
                  key={request.request_id}
                  data-testid={`pending-approval-row-${request.request_id}`}
                >
                  <td className="mono">{shortId(request.request_id)}</td>
                  <td>{request.extension_id}</td>
                  <td>
                    <span className="badge">
                      {tierLabel(request.requested_tier)}
                    </span>
                  </td>
                  <td className="muted">
                    {shortId(request.requested_by_profile_id)}
                  </td>
                  <td className="muted">{request.created_at}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() =>
                        void approvePromotion(transport, request.request_id)
                      }
                      disabled={disabledReason !== null}
                      title={disabledReason ?? undefined}
                      data-testid={`pending-approval-approve-${request.request_id}`}
                      aria-label={`Approve promotion of ${request.extension_id}`}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
