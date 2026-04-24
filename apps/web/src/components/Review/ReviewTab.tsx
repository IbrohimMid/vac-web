// Review tab: changeset file list; click opens DiffViewer overlay.

import { SeverityIcon, type Severity } from '../SeverityIcon';
import { useOverlays } from '../../stores/overlays';
import { useReview, type ReviewFile } from '../../stores/review';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

const STATUS_SEV: Record<ReviewFile['status'], Severity> = {
  added: 'ok',
  modified: 'info',
  deleted: 'error',
  renamed: 'warn',
};

export function ReviewTab({ transport }: Props) {
  const files = useReview((s) => s.files);
  const sessionId = useSession((s) => s.sessionId);

  const open = (path: string) => {
    useOverlays.getState().open('diff_viewer', { path, transport });
  };

  const revertAll = async () => {
    if (!transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'review.revert_all', {});
    } catch {
      /* event-driven; ignore rejection here */
    }
  };

  if (files.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-2)' }}>No pending changes.</div>;
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>{files.length} files</strong>
        <button onClick={revertAll} disabled={!transport}>
          Revert all
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {files.map((f) => (
          <li
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderBottom: '1px solid var(--border-1, #2a2a2a)',
              cursor: 'pointer',
            }}
            onClick={() => open(f.path)}
          >
            <SeverityIcon severity={STATUS_SEV[f.status]} />
            <span style={{ flex: 1, fontFamily: 'monospace' }}>{f.path}</span>
            <span style={{ color: 'var(--sev-ok)', fontSize: 12 }}>+{f.additions}</span>
            <span style={{ color: 'var(--sev-error)', fontSize: 12 }}>-{f.deletions}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
