import { SeverityIcon } from '../SeverityIcon';
import { useNotify } from '../../stores/notify';

export function TransientToasts() {
  const items = useNotify((s) => s.transient);
  const dismiss = useNotify((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((n) => (
        <div
          key={n.id}
          className="toast"
          style={{
            // Border-left tinted by severity per ux-grammar §10.
            borderLeft: `3px solid var(--${toneVar(n.severity)})`,
          }}
        >
          <SeverityIcon severity={n.severity} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{n.message}</div>
          </div>
          <button
            aria-label="dismiss"
            onClick={() => dismiss(n.id)}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              fontSize: 14,
              width: 20,
              height: 20,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function toneVar(sev: string): string {
  if (sev === 'ok') return 'ok';
  if (sev === 'warn') return 'warn';
  if (sev === 'error') return 'crit';
  return 'info';
}

export function StickyBanners() {
  const items = [...useNotify((s) => s.sticky).values()];
  if (items.length === 0) return null;
  return (
    <div aria-live="assertive">
      {items.map((n) => (
        <div
          key={n.id}
          style={{
            background: `var(--${toneVar(n.severity)}-soft)`,
            color: `var(--${toneVar(n.severity)})`,
            padding: '8px 14px',
            fontSize: 13,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            borderBottom: `1px solid var(--${toneVar(n.severity)})`,
          }}
        >
          <SeverityIcon severity={n.severity} />
          <strong>{n.title}</strong>
          <span style={{ color: 'var(--ink-2)' }}>{n.message}</span>
        </div>
      ))}
    </div>
  );
}

export function PersistentRail() {
  const items = useNotify((s) => s.persistent);
  const dismiss = useNotify((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <aside
      aria-label="Notifications"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        background: 'var(--panel)',
        maxHeight: 240,
        overflowY: 'auto',
        margin: 'var(--gap) var(--pad)',
      }}
    >
      <header
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--line)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-2)',
        }}
      >
        Notifications ({items.length})
      </header>
      {items.map((n) => (
        <div
          key={n.id}
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--line-soft)',
            fontSize: 12,
            display: 'flex',
            gap: 8,
          }}
        >
          <SeverityIcon severity={n.severity} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{n.title}</div>
            <div style={{ color: 'var(--ink-3)' }}>{n.message}</div>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss notification"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              fontSize: 14,
              width: 20,
              height: 20,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
