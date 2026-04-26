// Review tab: changeset file list + X.5c.2 inline ACP diffs.

import { SeverityIcon, type Severity } from '../SeverityIcon';
import { useOverlays } from '../../stores/overlays';
import { useReview, type ReviewFile } from '../../stores/review';
import { useToolActivity } from '../../stores/toolActivity';
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

  // X.5c.2 — inline ACP diffs from tool activity observe stream
  const inlineDiffOrder = useToolActivity((s) => s.inlineDiffOrder);
  const inlineDiffs = useToolActivity((s) => s.inlineDiffs);
  const sid = sessionId ?? '';
  const prefix = sid ? `${sid}\x00` : null;
  const acpDiffs = prefix
    ? inlineDiffOrder
        .filter((k) => k.startsWith(prefix))
        .map((k) => inlineDiffs.get(k))
        .filter((x) => x != null)
    : [];

  const hasAnything = files.length > 0 || acpDiffs.length > 0;

  if (!hasAnything) {
    return <div style={{ padding: 16, color: 'var(--text-2)' }}>No pending changes.</div>;
  }

  return (
    <div role="region" aria-label="Changeset review" style={{ padding: 8 }}>
      {files.length > 0 && (
        <>
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
        </>
      )}

      {acpDiffs.length > 0 && (
        <div style={{ marginTop: files.length > 0 ? 16 : 0 }}>
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
            ACP edits observed ({acpDiffs.length})
          </div>
          {acpDiffs.map((d) =>
            d!.diffs.map((diff, i) => (
              <div
                key={`${d!.tool_call_id}-${i}`}
                style={{
                  marginBottom: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    padding: '5px 8px',
                    background: 'var(--surface-2)',
                    fontFamily: 'monospace',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span aria-label={`File path: ${diff.path}`}>{diff.path}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
                    {d!.status}
                    {d!.approved_by_approval_id && (
                      <span
                        aria-label="Approved edit"
                        style={{
                          marginLeft: 6,
                          padding: '1px 4px',
                          borderRadius: 3,
                          background: 'var(--ok)',
                          color: '#fff',
                        }}
                      >
                        Approved edit
                      </span>
                    )}
                  </span>
                </div>
                {diff.old_text == null ? (
                  <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--sev-ok)' }}>
                    New file
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <pre
                      aria-label="Old text"
                      style={{
                        margin: 0,
                        padding: '6px 8px',
                        background: 'rgba(255,0,0,0.05)',
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: 160,
                        overflow: 'auto',
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      {diff.old_text}
                    </pre>
                    <pre
                      aria-label="New text"
                      style={{
                        margin: 0,
                        padding: '6px 8px',
                        background: 'rgba(0,200,0,0.05)',
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: 160,
                        overflow: 'auto',
                      }}
                    >
                      {diff.new_text}
                    </pre>
                  </div>
                )}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
