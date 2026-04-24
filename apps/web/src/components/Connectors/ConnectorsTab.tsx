// Connector manager: inventory + connect/disconnect. OAuth redirect handled
// via bridge-provided URL; bridge captures callback and emits `connector.health`.

import { useEffect } from 'react';
import { SeverityIcon, type Severity } from '../SeverityIcon';
import { useConnectors, type ConnectorHealth } from '../../stores/connectors';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

const HEALTH_SEV: Record<ConnectorHealth, Severity> = {
  connected: 'ok',
  degraded: 'warn',
  disconnected: 'error',
  unknown: 'info',
};

const KNOWN_PROVIDERS = ['github', 'notion'] as const;

export function ConnectorsTab({ transport }: Props) {
  const items = useConnectors((s) => s.items);

  useEffect(() => {
    if (!transport) return;
    transport.send('', 'connector.list', {}).catch(() => {});
  }, [transport]);

  const connect = async (provider: string) => {
    if (!transport) return;
    try {
      await transport.send('', 'connector.connect', { provider });
      // Bridge responds with `connector.oauth_url` event; app opens it.
    } catch {
      /* surfaced via notify */
    }
  };

  const disconnect = async (id: string) => {
    if (!transport) return;
    try {
      await transport.send('', 'connector.disconnect', { id });
    } catch {
      /* ignore */
    }
  };

  const connected = Array.from(items.values());
  const connectedProviders = new Set(connected.map((c) => c.provider));

  return (
    <div style={{ padding: 8 }}>
      <section>
        <h3 style={{ margin: '8px 0' }}>Connected</h3>
        {connected.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>No connectors yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {connected.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  borderBottom: '1px solid var(--border-1, #2a2a2a)',
                }}
              >
                <SeverityIcon severity={HEALTH_SEV[c.health]} />
                <div style={{ flex: 1 }}>
                  <strong>{c.label}</strong>
                  {c.account && (
                    <span style={{ marginLeft: 6, color: 'var(--text-2)', fontSize: 12 }}>
                      @{c.account}
                    </span>
                  )}
                  {c.rateLimit && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-2)' }}>
                      {c.rateLimit.remaining}/{c.rateLimit.limit} rate
                    </span>
                  )}
                </div>
                <button onClick={() => disconnect(c.id)} disabled={!transport}>
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section style={{ marginTop: 16 }}>
        <h3 style={{ margin: '8px 0' }}>Available</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {KNOWN_PROVIDERS.filter((p) => !connectedProviders.has(p)).map((p) => (
            <li
              key={p}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 8,
                borderBottom: '1px solid var(--border-1, #2a2a2a)',
              }}
            >
              <span style={{ flex: 1, textTransform: 'capitalize' }}>{p}</span>
              <button onClick={() => connect(p)} disabled={!transport}>
                Connect
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
