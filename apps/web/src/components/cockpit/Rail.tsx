// Right rail — 4 tabs (Activity / Notify / Context / Memory).
// Activity reads useActivity; Notify reads useNotify (sticky + persistent);
// Context shows connector inventory + last touched files (existing stores);
// Memory shows session metadata.

import { useActivity } from '../../stores/activity';
import { useCockpit, type RailTab } from '../../stores/cockpit';
import { useConnectors, type ConnectorHealth } from '../../stores/connectors';
import { useNotify } from '../../stores/notify';
import { useReview } from '../../stores/review';
import { useSession } from '../../stores/session';
import { authMethodSummary, authMethodTypeLabel } from '../../domain/sessions/auth';
import { Icon, type IconName } from './primitives';

const TABS: RailTab[] = ['Activity', 'Notify', 'Context', 'Memory'];

export function Rail() {
  const tab = useCockpit((s) => s.railTab);
  const setTab = useCockpit((s) => s.setRailTab);
  const stickyCount = useNotify((s) => s.sticky.size);

  return (
    <aside className="rail">
      <div className="rail-tabs">
        {TABS.map((t) => (
          <div
            key={t}
            className={`rail-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
          >
            {t}
            {t === 'Activity' && (
              <span
                className="badge accent rail-badge-tight"
              >
                live
              </span>
            )}
            {t === 'Notify' && stickyCount > 0 && (
              <span className="badge crit rail-badge-tight">!</span>
            )}
          </div>
        ))}
      </div>
      <div className="rail-body">
        {tab === 'Activity' && <RailActivity />}
        {tab === 'Notify' && <RailNotify />}
        {tab === 'Context' && <RailContext />}
        {tab === 'Memory' && <RailMemory />}
      </div>
    </aside>
  );
}

function RailActivity() {
  const entries = useActivity((s) => s.entries);
  if (entries.length === 0) {
    return (
      <div className="rail-empty">No activity yet.</div>
    );
  }
  return (
    <>
      <div className="rail-section-head">
        <div className="rail-section-title">Live activity</div>
        <span className="badge ok">
          <span className="dot" style={{ background: 'currentColor' }}></span>
          Streaming
        </span>
      </div>
      {entries.slice(0, 30).map((a) => {
        const icon = severityIcon(a.severity);
        return (
          <div key={a.id} className="act-item">
            <div className="act-icon">
              <Icon name={icon} size={13} />
            </div>
            <div className="act-body">
              <div>
                <strong>{a.subsystem}</strong> · {a.summary}
              </div>
              <div className="when">{a.ts}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function severityIcon(sev: string): IconName {
  switch (sev) {
    case 'ok':
      return 'check';
    case 'warn':
      return 'alert';
    case 'error':
      return 'x-circle';
    case 'info':
    default:
      return 'info';
  }
}

function RailNotify() {
  const sticky = useNotify((s) => s.sticky);
  const persistent = useNotify((s) => s.persistent);
  const items = [...Array.from(sticky.values()), ...persistent];
  if (items.length === 0) {
    return (
      <div className="rail-empty">No notifications.</div>
    );
  }
  return (
    <>
      {items.slice(0, 12).map((n) => (
        <div key={n.id} className="rail-card">
          <div className="rail-row">
            <span className={`badge ${n.severity === 'error' ? 'crit' : n.severity}`}>
              {n.subsystem}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {n.ts}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 500 }}>{n.title}</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}
          >
            {n.message}
          </div>
        </div>
      ))}
    </>
  );
}

const HEALTH_ICON: Record<ConnectorHealth, 'ok' | 'warn' | 'crit' | 'idle'> = {
  connected: 'ok',
  degraded: 'warn',
  disconnected: 'crit',
  unknown: 'idle',
};

function RailContext() {
  const connectors = useConnectors((s) => s.items);
  const files = useReview((s) => s.files);
  return (
    <>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-2)',
          marginBottom: 8,
        }}
      >
        Connectors
      </div>
      {connectors.size === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          None connected.
        </div>
      ) : (
        Array.from(connectors.values())
          .slice(0, 6)
          .map((c) => (
            <div key={c.id} className="rail-card">
              <Icon name={connectorIcon(c.provider)} size={14} />
              <div className="flex1">
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.label}</div>
                <div
                  className="src"
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5 }}
                >
                  {c.account ?? c.provider}
                </div>
              </div>
              <span
                className={`badge ${HEALTH_ICON[c.health]}`}
                style={{ padding: '1px 5px' }}
              >
                {c.health}
              </span>
            </div>
          ))
      )}
      {files.length > 0 && (
        <>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-2)',
              margin: '14px 0 8px',
            }}
          >
            Active changeset
          </div>
          {files.slice(0, 5).map((f) => (
            <div key={f.path} className="rail-card">
              <Icon name="file-code" size={14} />
              <div className="flex1">
                <div style={{ fontSize: 12.5 }}>{f.path}</div>
                <div className="src">
                  +{f.additions} / -{f.deletions} · {f.status}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function connectorIcon(provider: string): IconName {
  if (provider === 'github') return 'github';
  if (provider === 'notion') return 'notion';
  if (provider === 'sentry') return 'sentry';
  if (provider === 'figma') return 'figma';
  return 'folder';
}

function RailMemory() {
  const session = useSession();
  const authMethods = session.authMethods;
  return (
    <>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-2)',
          marginBottom: 8,
        }}
      >
        Session memory
      </div>
      <div
        className="muted"
        style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}
      >
        Session-scoped state and exports. Pinned items survive reloads; auto
        items decay if unused.
      </div>
      <div className="rail-card" style={{ padding: '8px 12px' }}>
        <div className="rail-row">
          <span
            className="badge accent rail-badge-tight"
          >
            Pinned
          </span>
        </div>
        <div className="rail-card-copy">
          Session: <code>{session.sessionId ?? '(none)'}</code>
        </div>
      </div>
      <div className="rail-card" style={{ padding: '8px 12px' }}>
        <div className="rail-row">
          <span
            className="badge accent rail-badge-tight"
          >
            Pinned
          </span>
        </div>
        <div className="rail-card-copy">
          Profile: <code>{session.profileId ?? '(none)'}</code>
        </div>
      </div>
      <div className="rail-card" style={{ padding: '8px 12px' }}>
        <div className="rail-row">
          <span
            className="badge accent rail-badge-tight"
          >
            Pinned
          </span>
        </div>
        <div className="rail-card-copy">
          Agent: <code>{session.agentId ?? '(none)'}</code>
          {' · '}
          Kind: <code>{session.agentKind ?? '(none)'}</code>
        </div>
      </div>
      {session.agentKind === 'acp' && (
        <div className="rail-card" style={{ padding: '8px 12px' }}>
          <div className="rail-row">
            <span className="badge warn" style={{ padding: '1px 6px', fontSize: 10.5 }}>
              ACP auth
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {authMethodSummary(authMethods)}
            </span>
          </div>
          {authMethods.length === 0 ? (
            <div className="rail-card-copy">
              No auth methods were advertised by the adapter. If the provider later
              reports an auth requirement, the bridge can surface a reauth affordance
              from the same session metadata.
            </div>
          ) : (
            authMethods.map((method) => (
              <div key={method.id} className="rail-card">
                <div className="rail-row">
                  <strong style={{ fontSize: 12.5 }}>{method.name}</strong>
                  <span className="badge accent rail-badge-tight">
                    {authMethodTypeLabel(method)}
                  </span>
                </div>
                {method.description && (
                  <div className="rail-card-copy">
                    {method.description}
                  </div>
                )}
                {method.link && (
                  <div className="rail-card-meta">
                    {method.link}
                  </div>
                )}
                {method.vars?.length ? (
                  <div className="rail-card-meta">
                    vars: {method.vars.map((v) => v.label ?? v.name).join(', ')}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
