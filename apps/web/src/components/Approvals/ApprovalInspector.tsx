// Inspector overlay: full args JSON + metadata for a pending tool call.

import { useApprovals } from '../../stores/approvals';
import type { OverlayRenderProps } from '../../overlays/registry';

export function ApprovalInspector({ params, dismiss }: OverlayRenderProps) {
  const toolCallId = typeof params.toolCallId === 'string' ? params.toolCallId : null;
  const tc = useApprovals((s) => (toolCallId ? s.pending.get(toolCallId) : undefined));

  if (!tc) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Approval inspector"
        style={dialogStyle}
      >
        <header style={headerStyle}>
          <strong>Inspector</strong>
          <button onClick={dismiss} aria-label="Close">
            Close
          </button>
        </header>
        <p style={{ padding: 16 }}>Tool call not found (already resolved?).</p>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Approval inspector" style={dialogStyle}>
      <header style={headerStyle}>
        <strong>{tc.tool}</strong>
        <button onClick={dismiss} aria-label="Close">
          Close
        </button>
      </header>
      <dl style={{ padding: 16, margin: 0, display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6 }}>
        <dt>Risk</dt>
        <dd>{tc.risk}</dd>
        <dt>Summary</dt>
        <dd>{tc.summary || '—'}</dd>
        <dt>Created</dt>
        <dd>{tc.createdAt}</dd>
      </dl>
      <div style={{ padding: 16, paddingTop: 0 }}>
        <strong style={{ display: 'block', marginBottom: 4 }}>Args</strong>
        <pre
          style={{
            background: 'var(--bg-2, #111)',
            padding: 8,
            borderRadius: 4,
            maxHeight: 320,
            overflow: 'auto',
            fontSize: 12,
          }}
        >
          {JSON.stringify(tc.args, null, 2)}
        </pre>
      </div>
    </div>
  );
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-1, #1a1a1a)',
  color: 'var(--text-1)',
  border: '1px solid var(--border-1, #333)',
  borderRadius: 8,
  width: 'min(640px, 90vw)',
  maxHeight: '80vh',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-1, #333)',
};
