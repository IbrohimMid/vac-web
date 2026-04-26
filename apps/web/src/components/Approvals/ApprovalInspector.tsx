// Approval inspector — Stage H restyle.
// Cockpit `.card` chrome, severity badge for risk, kv-rows for metadata,
// args rendered in a `.tool-call-body` flavored monospace block.

import { useApprovals, type RiskLevel } from '../../stores/approvals';
import type { OverlayRenderProps } from '../../overlays/registry';

const RISK_BADGE: Record<RiskLevel, { className: string; label: string }> = {
  low: { className: 'badge ok', label: 'low risk' },
  medium: { className: 'badge warn', label: 'medium risk' },
  high: { className: 'badge crit', label: 'high risk' },
};

export function ApprovalInspector({ params, dismiss }: OverlayRenderProps) {
  const approvalId =
    typeof params.approvalId === 'string'
      ? params.approvalId
      : typeof params.toolCallId === 'string'
        ? params.toolCallId
        : null;
  const tc = useApprovals((s) => (approvalId ? s.pending.get(approvalId) : undefined));

  if (!tc) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Approval inspector"
        className="card"
        style={cardSize}
      >
        <header className="card-hd">
          <div className="card-title">Inspector</div>
          <div className="spacer"></div>
          <button className="btn ghost" onClick={dismiss}>
            Close
          </button>
        </header>
        <p
          className="muted"
          style={{ padding: 16, fontSize: 13, margin: 0 }}
        >
          Approval not found (already resolved?).
        </p>
      </div>
    );
  }

  const risk = RISK_BADGE[tc.risk];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approval inspector"
      className="card"
      style={cardSize}
    >
      <header className="card-hd">
        <div className="card-title mono" style={{ fontFamily: 'var(--font-mono)' }}>
          {tc.tool}
        </div>
        <span className={risk.className}>
          <span className="dot" style={{ background: 'currentColor' }}></span>
          {risk.label}
        </span>
        <div className="spacer"></div>
        <button className="btn ghost" onClick={dismiss}>
          Close
        </button>
      </header>
      <div className="card-body" style={{ padding: 16, fontSize: 12.5 }}>
        <div className="kv-row">
          <span className="k">Approval ID</span>
          <span className="v" style={{ fontFamily: 'var(--font-mono)' }}>
            {tc.approvalId}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Tool call ID</span>
          <span className="v" style={{ fontFamily: 'var(--font-mono)' }}>
            {tc.toolCallId}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Source</span>
          <span className="v" style={{ fontFamily: 'var(--font-mono)' }}>
            {tc.sourceEventType}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Summary</span>
          <span className="v" style={{ fontFamily: 'var(--font-sans)' }}>
            {tc.summary || '—'}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Created</span>
          <span className="v" style={{ fontFamily: 'var(--font-sans)' }}>
            {tc.createdAt}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">Expires</span>
          <span className="v" style={{ fontFamily: 'var(--font-sans)' }}>
            {tc.expiresInMs != null ? `${tc.expiresInMs} ms` : '—'}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">State</span>
          <span className="v" style={{ fontFamily: 'var(--font-sans)' }}>
            {tc.state}
          </span>
        </div>

        <div
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-3)',
            margin: '14px 0 6px',
          }}
        >
          Args
        </div>
        <pre
          style={{
            background: 'var(--bg-sunken)',
            border: '1px solid var(--line)',
            color: 'var(--ink-2)',
            padding: 10,
            borderRadius: 'var(--r-sm)',
            maxHeight: 320,
            overflow: 'auto',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {JSON.stringify(tc.args, null, 2)}
        </pre>

        {tc.options.length > 0 && (
          <>
            <div
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--ink-3)',
                margin: '14px 0 6px',
              }}
            >
              Options
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tc.options.map((opt) => (
                <span
                  key={opt.optionId}
                  className="badge"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                >
                  {opt.kind} · {opt.name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const cardSize: React.CSSProperties = {
  width: 'min(640px, 90vw)',
  maxHeight: '80vh',
  overflow: 'auto',
};
