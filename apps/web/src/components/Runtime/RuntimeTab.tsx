// Runtime tab: job list + selected-job log tail. Cancel in-flight jobs.

import { useState } from 'react';
import { useRuntime } from '../../stores/runtime';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

export function RuntimeTab({ transport }: Props) {
  const jobsMap = useRuntime((s) => s.jobs);
  const order = useRuntime((s) => s.order);
  const logs = useRuntime((s) => s.logs);
  const sessionId = useSession((s) => s.sessionId);
  const [selected, setSelected] = useState<string | null>(order[0] ?? null);

  const cancel = async (id: string) => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'runtime.cancel_job', { job_id: id });
    } catch {
      /* ignore */
    }
  };

  if (order.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-2)' }}>No jobs.</div>;
  }

  const selectedLogs = selected ? logs.get(selected) ?? [] : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 8 }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {order.map((id) => {
          const j = jobsMap.get(id);
          if (!j) return null;
          return (
            <li
              key={id}
              onClick={() => setSelected(id)}
              style={{
                padding: 8,
                borderBottom: '1px solid var(--border-1, #2a2a2a)',
                background: selected === id ? 'var(--bg-2, #222)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{j.label}</strong>
                <span style={{ fontSize: 11 }}>{j.status}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{j.kind}</div>
              {(j.status === 'running' || j.status === 'pending') && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void cancel(id);
                  }}
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
              <div key={i} style={{ color: l.stream === 'stderr' ? 'var(--sev-error)' : undefined }}>
                {l.text}
              </div>
            ))}
      </pre>
    </div>
  );
}
