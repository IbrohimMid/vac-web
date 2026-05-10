// Runtime tab: job list + selected-job log tail + X.5c.2 ACP execute stream.

import { useEffect, useState } from 'react';
import { useRuntime } from '../../stores/runtime';
import { useToolActivity } from '../../stores/toolActivity';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';
import {
  affordanceFor,
  toAffordanceStatus,
} from '../../domain/capabilities/affordanceCatalog';

interface Props {
  transport: TransportHandle | null;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function RuntimeTab({ transport }: Props) {
  const jobsMap = useRuntime((s) => s.jobs);
  const order = useRuntime((s) => s.order);
  const logs = useRuntime((s) => s.logs);
  const sessionId = useSession((s) => s.sessionId);
  const [selected, setSelected] = useState<string | null>(order[0] ?? null);

  // X.5c.2 ACP execute log stream (observe-only)
  const acpLogOrder = useToolActivity((s) => s.acpLogOrder);
  const acpLogs = useToolActivity((s) => s.acpLogs);
  const prefix = sessionId ? `${sessionId}\x00` : null;
  const acpEntries = prefix
    ? acpLogOrder
        .filter((k) => k.startsWith(prefix))
        .map((k) => acpLogs.get(k))
        .filter((x) => x != null)
    : [];

  useEffect(() => {
    if (selected && order.includes(selected)) return;
    setSelected(order[0] ?? null);
  }, [order, selected]);

  const cancelDecision = affordanceFor('runtime.cancel_job.button', {
    commandStatus: toAffordanceStatus('runtime.cancel_job'),
    hasTransport: !!transport,
    hasSessionId: !!sessionId,
  });

  const cancel = async (id: string) => {
    if (!cancelDecision.enabled) return;
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'runtime.cancel_job', { job_id: id });
    } catch {
      /* ignore */
    }
  };

  if (order.length === 0 && acpEntries.length === 0) {
    return <div className="soft-empty">No runtime jobs yet.</div>;
  }

  const selectedLogs = selected ? (logs.get(selected) ?? []) : [];

  return (
    <div className="screen-shell">
      <header className="screen-hero">
        <div className="screen-hero-row">
          <div>
            <h3 className="screen-title">Runtime</h3>
            <div className="screen-subtitle">Track terminal jobs, subprocess output, redaction, and tool execution state.</div>
          </div>
          <span className="badge">{order.length} jobs</span>
        </div>
      </header>
      {order.length > 0 && (
        <div
          role="region"
          aria-label="Runtime jobs"
          style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 8 }}
        >
          <ul className="soft-list panel-card">
            {order.map((id) => {
              const j = jobsMap.get(id);
              if (!j) return null;
              return (
                <li
                  key={id}
                  onClick={() => setSelected(id)}
                  style={{
                    padding: 8,
                    borderBottom: '1px solid var(--line)',
                    background: selected === id ? 'var(--bg-2, #222)' : 'transparent',
                    cursor: 'pointer',
                  }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{j.label}</strong>
                    <span style={{ fontSize: 11 }}>{j.status}</span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-2)' }}>{j.kind}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                    {j.toolCallId && `tool_call: ${shortId(j.toolCallId)}`}
                    {j.approvedByApprovalId && ` · approval: ${shortId(j.approvedByApprovalId)}`}
                    {j.sourceEventType && ` · src: ${j.sourceEventType}`}
                  </div>
                  {(j.commandPreview || j.outputTruncated || j.outputRedacted) && (
                    <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {j.commandPreview && (
                        <code
                          aria-label="Command preview"
                          style={{
                            background: 'var(--surface-2)',
                            padding: '1px 6px',
                            borderRadius: 3,
                            fontSize: 11,
                          }}
                        >
                          {j.commandPreview}
                        </code>
                      )}
                      {j.outputRedacted && (
                        <span aria-label="Output redacted" style={{ fontSize: 10, color: 'var(--warn)' }}>
                          Output redacted
                        </span>
                      )}
                      {j.outputTruncated && (
                        <span aria-label="Output truncated" style={{ fontSize: 10, color: 'var(--text-2)' }}>
                          Output truncated
                        </span>
                      )}
                    </div>
                  )}
                  {(j.status === 'running' || j.status === 'pending') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void cancel(id);
                      }}
                      disabled={!cancelDecision.enabled}
                      data-affordance-id={cancelDecision.affordanceId}
                      title={cancelDecision.disabledReason ?? ''}
                      style={{ marginTop: 4, fontSize: 11 }}
                    >
                      Cancel
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <pre
            style={{
              background: 'var(--bg-2, #111)',
              padding: 8,
              margin: 0,
              overflow: 'auto',
              maxHeight: 400,
              fontSize: 12,
            }}
          >
            {selectedLogs.length === 0
              ? '(no logs yet)'
              : selectedLogs.map((l, i) => (
                  <div
                    key={i}
                    style={{ color: l.stream === 'stderr' ? 'var(--sev-error)' : undefined }}
                  >
                    {l.text}
                  </div>
                ))}
          </pre>
        </div>
      )}

      {acpEntries.length > 0 && (
        <div
          role="region"
          aria-label="ACP execute log"
          style={{ marginTop: order.length > 0 ? 16 : 0 }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-2)',
              padding: '4px 8px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-1)',
            }}
          >
            ACP execute log ({acpEntries.length})
          </div>
          {acpEntries.map((e) => (
            <div
              key={e!.tool_call_id}
              style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {e!.command && (
                  <code
                    aria-label="Command"
                    style={{
                      background: 'var(--surface-2)',
                      padding: '1px 6px',
                      borderRadius: 3,
                      fontSize: 11,
                    }}
                  >
                    {e!.command}
                  </code>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{e!.status}</span>
                {e!.approved_by_approval_id && (
                  <span
                    aria-label="Approved by you"
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
                )}
                {e!.redacted && (
                  <span aria-label="Output redacted" style={{ fontSize: 10, color: 'var(--warn)' }}>
                    Output redacted
                  </span>
                )}
                {e!.truncated && (
                  <span aria-label="Output truncated" style={{ fontSize: 10, color: 'var(--text-2)' }}>
                    Output truncated
                  </span>
                )}
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                tool_call: {shortId(e!.tool_call_id)}
                {e!.approved_by_approval_id && ` · approval: ${shortId(e!.approved_by_approval_id)}`}
                {e!.source_event_type && ` · src: ${e!.source_event_type}`}
              </div>
              {e!.output && (
                <pre
                  style={{
                    margin: '6px 0 0',
                    padding: '4px 6px',
                    background: 'var(--surface-2)',
                    borderRadius: 3,
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {e!.output}
                </pre>
              )}
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-2)' }}>
                {new Date(e!.ts).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
