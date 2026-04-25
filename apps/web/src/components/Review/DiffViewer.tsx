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
      className="card"
      style={dialogStyle}
    >
      <header className="card-hd">
        <span
          className="badge"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
        >
          {path}
        </span>
        <div className="spacer"></div>
        <button className="btn" onClick={revert} disabled={!transport}>
          Revert file
        </button>
        <button className="btn ghost" onClick={dismiss}>
          Close
        </button>
      </header>
      {!diff ? (
        <p className="muted" style={{ padding: 16, fontSize: 13, margin: 0 }}>
          Loading diff…
        </p>
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
        <p
          style={{
            padding: '8px 16px',
            fontSize: 12,
            color: 'var(--warn)',
            margin: 0,
            background: 'var(--warn-soft)',
            borderTop: '1px solid var(--warn)',
          }}
        >
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
  let bg: string | undefined;
  if (first === '+') {
    color = 'var(--ok)';
    bg = 'var(--ok-soft)';
  } else if (first === '-') {
    color = 'var(--crit)';
    bg = 'var(--crit-soft)';
  } else if (first === '@') {
    color = 'var(--info)';
  }
  return (
    <div
      style={{
        color,
        background: bg,
        whiteSpace: 'pre',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: '18px',
        padding: '0 8px',
      }}
    >
      {text || ' '}
    </div>
  );
}

const dialogStyle: React.CSSProperties = {
  width: 'min(900px, 92vw)',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
};

const preStyle: React.CSSProperties = {
  background: 'var(--bg-sunken)',
  padding: '8px 0',
  margin: 0,
  overflow: 'auto',
  flex: 1,
  borderTop: '1px solid var(--line)',
};
