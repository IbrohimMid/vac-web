import { SeverityIcon } from '../SeverityIcon';
import { useNotify } from '../../stores/notify';

export function TransientToasts() {
  const items = useNotify((s) => s.transient);
  const dismiss = useNotify((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 60,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 900,
        maxWidth: 360,
      }}
    >
      {items.map((n) => (
        <div
          key={n.id}
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid var(--sev-${n.severity})`,
            padding: '8px 12px',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            display: 'flex',
            gap: 8,
          }}
        >
          <SeverityIcon severity={n.severity} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{n.message}</div>
          </div>
          <button
            aria-label="dismiss"
            onClick={() => dismiss(n.id)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
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
            background: `var(--sev-${n.severity}, var(--surface-2))`,
            color: 'white',
            padding: '6px 12px',
            fontSize: 13,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <SeverityIcon severity={n.severity} />
          <strong>{n.title}</strong>
          <span>{n.message}</span>
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
        border: '1px solid var(--border)',
        borderRadius: 4,
        maxHeight: 240,
        overflowY: 'auto',
        margin: '8px 0',
      }}
    >
      <header style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600 }}>
        Notifications ({items.length})
      </header>
      {items.map((n) => (
        <div
          key={n.id}
          style={{
            padding: '6px 8px',
            borderBottom: '1px solid var(--border)',
            fontSize: 12,
            display: 'flex',
            gap: 8,
          }}
        >
          <SeverityIcon severity={n.severity} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{n.title}</div>
            <div style={{ color: 'var(--text-2)' }}>{n.message}</div>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
