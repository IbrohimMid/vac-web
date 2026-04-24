// Diff viewer overlay. Lazy-fetches diff body on mount via `review.open_file`,
// virtualizes hunk lines for large files (> 500 lines), offers Revert.

import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useReview } from '../../stores/review';
import { useSession } from '../../stores/session';
import type { OverlayRenderProps } from '../../overlays/registry';
import type { TransportHandle } from '../../transport';

const VIRTUAL_THRESHOLD = 500;

export function DiffViewer({ params, dismiss }: OverlayRenderProps) {
  const path = typeof params.path === 'string' ? params.path : null;
  const transport = (params.transport as TransportHandle | undefined) ?? null;
  const sessionId = useSession((s) => s.sessionId);
  const diff = useReview((s) => (path ? s.diffs.get(path) : undefined));

  useEffect(() => {
    if (!path || !transport || !sessionId) return;
    if (useReview.getState().diffs.has(path)) return;
    if (useReview.getState().isFetching(path)) return;
    useReview.getState().markFetching(path);
    transport.send(sessionId, 'review.open_file', { path }).catch(() => {
      /* diff_chunk event resolves store; errors surface via notify lane */
    });
  }, [path, transport, sessionId]);

  const revert = async () => {
    if (!path || !transport || !sessionId) return;
    try {
      await transport.send(sessionId, 'review.revert_file', { path });
      dismiss();
    } catch {
      /* leave open; notify lane shows error */
    }
  };

  const lines = useMemo(() => (diff ? diff.unified.split('\n') : []), [diff]);
  const useVirtual = lines.length > VIRTUAL_THRESHOLD;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Diff: ${path ?? 'unknown'}`}
      style={dialogStyle}
    >
      <header style={headerStyle}>
        <strong style={{ fontFamily: 'monospace' }}>{path}</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={revert} disabled={!transport}>
            Revert file
          </button>
          <button onClick={dismiss}>Close</button>
        </div>
      </header>
      {!diff ? (
        <p style={{ padding: 16 }}>Loading diff…</p>
      ) : useVirtual ? (
        <VirtualDiff lines={lines} />
      ) : (
        <pre style={preStyle}>
          {lines.map((l, i) => (
            <DiffLine key={i} text={l} />
          ))}
        </pre>
      )}
      {diff?.truncated && (
        <p style={{ padding: 8, fontSize: 12, color: 'var(--sev-warn)' }}>
          Diff truncated — file too large to render fully.
        </p>
      )}
    </div>
  );
}

function VirtualDiff({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 18,
    overscan: 20,
  });
  return (
    <div ref={ref} style={{ ...preStyle, height: 480, overflow: 'auto' }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => (
          <div
            key={item.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${item.start}px)`,
              height: item.size,
            }}
          >
            <DiffLine text={lines[item.index] ?? ''} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffLine({ text }: { text: string }) {
  const first = text[0];
  let color: string | undefined;
  if (first === '+') color = 'var(--sev-ok)';
  else if (first === '-') color = 'var(--sev-error)';
  else if (first === '@') color = 'var(--sev-info)';
  return <div style={{ color, whiteSpace: 'pre', fontFamily: 'monospace', fontSize: 12 }}>{text || ' '}</div>;
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-1, #1a1a1a)',
  color: 'var(--text-1)',
  border: '1px solid var(--border-1, #333)',
  borderRadius: 8,
  width: 'min(900px, 92vw)',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-1, #333)',
};

const preStyle: React.CSSProperties = {
  background: 'var(--bg-2, #111)',
  padding: 8,
  margin: 0,
  overflow: 'auto',
  flex: 1,
};
