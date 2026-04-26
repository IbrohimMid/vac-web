// X.5c.2 — ACP tool activity lane: observe-only stream of read/edit/execute/failed.
//
// Does NOT say "blocked", "prevented", or "enforced". Shows what the agent did.

import { useToolActivity, type ToolActivity, type ToolKind, type ToolStatus } from '../../stores/toolActivity';
import { useSession } from '../../stores/session';

function kindLabel(kind: ToolKind): string {
  if (kind === 'read') return 'Observed read';
  if (kind === 'edit') return 'Edit proposed';
  if (kind === 'execute') return 'Command executed';
  return 'Tool activity';
}

function statusColor(status: ToolStatus): string {
  if (status === 'failed') return 'var(--sev-error, var(--crit))';
  if (status === 'completed') return 'var(--sev-ok, var(--ok))';
  if (status === 'in_progress') return 'var(--sev-info, var(--accent))';
  return 'var(--text-2)';
}

function statusLabel(status: ToolStatus): string {
  if (status === 'in_progress') return 'in progress';
  return status;
}

function ProvenanceBadge({ a }: { a: ToolActivity }) {
  if (a.status === 'failed') {
    return (
      <span
        aria-label="Tool failed"
        style={{
          fontSize: 10,
          padding: '1px 5px',
          borderRadius: 3,
          background: 'var(--crit)',
          color: '#fff',
        }}
      >
        Rejected / task failed
      </span>
    );
  }
  if (a.approved_by_approval_id) {
    return (
      <span
        aria-label="Approved by you"
        title={`Approval: ${a.approved_by_approval_id}`}
        style={{
          fontSize: 10,
          padding: '1px 5px',
          borderRadius: 3,
          background: 'var(--ok)',
          color: '#fff',
        }}
      >
        Approved by you
      </span>
    );
  }
  if (a.kind === 'read' || a.kind === 'execute') {
    return (
      <span
        aria-label="Observed by bridge; not pre-approved"
        style={{
          fontSize: 10,
          padding: '1px 5px',
          borderRadius: 3,
          background: 'var(--surface-2)',
          color: 'var(--text-2)',
          border: '1px solid var(--border)',
        }}
      >
        Observed only
      </span>
    );
  }
  return (
    <span
      aria-label="Observed only"
      style={{
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 3,
        background: 'var(--surface-2)',
        color: 'var(--text-2)',
        border: '1px solid var(--border)',
      }}
    >
      Observed only
    </span>
  );
}

function ToolActivityRow({ a }: { a: ToolActivity }) {
  const primaryPath = a.locations[0]?.path ?? null;
  const outputPreview = a.raw_output_redacted
    ? a.raw_output_redacted.slice(0, 120) + (a.raw_output_redacted.length > 120 ? '…' : '')
    : null;

  return (
    <div
      style={{
        padding: '7px 10px',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: statusColor(a.status) }}>{kindLabel(a.kind)}</span>
        {a.title && a.title !== kindLabel(a.kind) && (
          <span style={{ color: 'var(--text-2)' }}>{a.title}</span>
        )}
        <span style={{ color: statusColor(a.status), fontSize: 11 }}>{statusLabel(a.status)}</span>
        <div style={{ marginLeft: 'auto' }}>
          <ProvenanceBadge a={a} />
        </div>
      </div>

      {primaryPath && (
        <div
          style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-2)' }}
          aria-label={`File path: ${primaryPath}`}
        >
          {primaryPath}
          {a.locations[0]?.line != null && `:${a.locations[0].line}`}
        </div>
      )}

      {a.outputRedacted && (
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--sev-warn, var(--warn))' }}>
          Output redacted
        </div>
      )}
      {a.outputTruncated && (
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-2)' }}>
          Output truncated
        </div>
      )}
      {outputPreview && !a.outputRedacted && (
        <pre
          style={{
            margin: '4px 0 0',
            padding: '3px 6px',
            background: 'var(--surface-2)',
            borderRadius: 3,
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 60,
            overflow: 'hidden',
          }}
        >
          {outputPreview}
        </pre>
      )}

      <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-2)' }}>
        {a.agent_id || 'agent'} · {new Date(a.ts).toLocaleTimeString()}
      </div>
    </div>
  );
}

interface Props {
  sessionId?: string | null;
}

export function ToolActivityLane({ sessionId }: Props) {
  const activityOrder = useToolActivity((s) => s.activityOrder);
  const activities = useToolActivity((s) => s.activities);
  const currentSession = useSession((s) => s.sessionId);
  const sid = sessionId ?? currentSession;

  const prefix = sid ? `${sid}\x00` : null;
  const items = prefix
    ? activityOrder
        .filter((k) => k.startsWith(prefix))
        .map((k) => activities.get(k))
        .filter((x): x is ToolActivity => x != null)
    : [];

  if (items.length === 0) {
    return (
      <div
        role="region"
        aria-label="ACP tool activity"
        style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text-2)' }}
      >
        No tool activity yet.
      </div>
    );
  }

  return (
    <div role="region" aria-label="ACP tool activity">
      <div
        style={{
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-2)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-1)',
          position: 'sticky',
          top: 0,
        }}
      >
        Tool Activity ({items.length})
      </div>
      {items.map((a) => (
        <ToolActivityRow key={a.tool_call_id} a={a} />
      ))}
    </div>
  );
}

// Diagnostics panel — hidden in production, useful for dev/debug
export function ToolActivityDiagnostics() {
  const d = useToolActivity((s) => s.diagnostics);
  return (
    <div
      aria-label="Tool activity diagnostics"
      style={{
        fontSize: 11,
        padding: '8px 10px',
        color: 'var(--text-2)',
        fontFamily: 'monospace',
      }}
    >
      <div>observed:{d.observed} updated:{d.updated} failed:{d.failed}</div>
      <div>invalid:{d.invalidPayload} redacted:{d.redactedOutput} truncated:{d.truncatedOutput}</div>
      <div>correlated:{d.approvalCorrelated} observed-only:{d.observedOnly}</div>
    </div>
  );
}
