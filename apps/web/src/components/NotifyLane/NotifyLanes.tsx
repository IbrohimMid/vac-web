import { SeverityIcon } from '../SeverityIcon';
import { affordanceFor } from '../../domain/capabilities/affordanceCatalog';
import { useNotify } from '../../stores/notify';

// Slice 33: dismiss is a frontend-owned affordance. Resolve once per
// module load — the decision is deterministic given the static context
// so repeating the lookup per click would be wasteful. Surfaces still
// pass the affordance id as a `data-affordance-id` so a follow-up audit
// (or a UI test that walks rendered surfaces) can detect a missing
// catalog entry.
const DISMISS_AFFORDANCE = affordanceFor('notify.dismiss', {
  commandStatus: 'frontend_owned',
  hasTransport: false,
  hasSessionId: false,
});

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
            data-affordance-id={DISMISS_AFFORDANCE.affordanceId}
            disabled={!DISMISS_AFFORDANCE.enabled}
            title={DISMISS_AFFORDANCE.disabledReason ?? undefined}
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
  const dismiss = useNotify((s) => s.dismiss);
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
          <span style={{ opacity: 0.85 }}>{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss banner"
            data-affordance-id={DISMISS_AFFORDANCE.affordanceId}
            disabled={!DISMISS_AFFORDANCE.enabled}
            title={DISMISS_AFFORDANCE.disabledReason ?? undefined}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
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
            data-affordance-id={DISMISS_AFFORDANCE.affordanceId}
            disabled={!DISMISS_AFFORDANCE.enabled}
            title={DISMISS_AFFORDANCE.disabledReason ?? undefined}
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
