// Sessions tab: list rows with status/profile/duration, resume/rename/close.

import { useEffect } from 'react';
import { activateSessionFromReady } from '../../domain/sessions/activation';
import { useSession } from '../../stores/session';
import { useSessions, type SessionRow } from '../../stores/sessions';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

export function SessionsTab({ transport }: Props) {
  const rows = useSessions((s) => s.rows);
  const current = useSession((s) => s.sessionId);

  useEffect(() => {
    if (!transport) return;
    transport.send('', 'session.list', {}).catch(() => {
      /* event resolves */
    });
  }, [transport]);

  const resume = async (row: SessionRow) => {
    if (!transport) return;
    const fallback = {
      profileId: row.profile_id,
      ...(row.project_root !== undefined ? { projectRoot: row.project_root } : {}),
    };
    const off = transport.on('session.ready', (ev) => {
      if (ev.session_id !== row.id) return;
      if (!activateSessionFromReady(ev.payload, fallback)) {
        return;
      }
      off();
    });
    try {
      const ack = await transport.send(row.id, 'session.resume', {});
      if (!ack.ok) {
        off();
      }
    } catch {
      off();
      /* notify handles failure */
    }
  };

  const close = async (id: string) => {
    if (!transport) return;
    try {
      await transport.send(id, 'session.close', {});
    } catch {
      /* ignore */
    }
  };

  const rename = async (id: string) => {
    const label = prompt('New label?');
    if (!label || !transport) return;
    try {
      await transport.send(id, 'session.rename', { label });
    } catch {
      /* ignore */
    }
  };

  if (rows.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-2)' }}>No sessions.</div>;
  }

  return (
    <table
      aria-label="Sessions"
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <thead>
        <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-2)' }}>
          <th style={th}>ID</th>
          <th style={th}>Profile</th>
          <th style={th}>Status</th>
          <th style={th}>Clients</th>
          <th style={th}>Created</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--border-1, #2a2a2a)' }}>
            <td style={{ ...td, fontFamily: 'monospace' }}>
              {r.id.slice(0, 12)}… {r.id === current ? '(current)' : ''}
            </td>
            <td style={td}>{r.profile_id}</td>
            <td style={td}>{r.status}</td>
            <td style={td}>{r.attached_clients}</td>
            <td style={td}>{r.created_at}</td>
            <td style={td}>
              <button onClick={() => resume(r)} disabled={!transport || r.id === current}>
                Resume
              </button>{' '}
              <button onClick={() => rename(r.id)} disabled={!transport}>
                Rename
              </button>{' '}
              <button onClick={() => close(r.id)} disabled={!transport}>
                Close
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '6px 8px' };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13 };
