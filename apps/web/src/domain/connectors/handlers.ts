import { useConnectors, type ConnectorHealth } from '../../stores/connectors';
import type { TransportHandle } from '../../transport';

function asHealth(raw: string | undefined): ConnectorHealth {
  if (raw === 'connected' || raw === 'degraded' || raw === 'disconnected') return raw;
  return 'unknown';
}

interface ListPayload {
  connectors: Array<{
    id: string;
    provider: string;
    label?: string;
    health?: string;
    rate_limit?: { remaining: number; limit: number; reset_at: string };
    account?: string;
  }>;
}

interface HealthPayload {
  id: string;
  health: string;
  rate_limit?: { remaining: number; limit: number; reset_at: string };
}

export function registerConnectorHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('connector.list', (ev) => {
      const p = ev.payload as ListPayload | null;
      if (!p?.connectors) return;
      useConnectors.getState().setAll(
        p.connectors.map((c) => ({
          id: c.id,
          provider: c.provider,
          label: c.label ?? c.provider,
          health: asHealth(c.health),
          ...(c.rate_limit ? { rateLimit: c.rate_limit } : {}),
          ...(c.account ? { account: c.account } : {}),
        })),
      );
    }),
  );

  offs.push(
    transport.on('connector.health', (ev) => {
      const p = ev.payload as HealthPayload | null;
      if (!p?.id) return;
      const existing = useConnectors.getState().items.get(p.id);
      if (!existing) return;
      useConnectors.getState().upsert({
        ...existing,
        health: asHealth(p.health),
        ...(p.rate_limit ? { rateLimit: p.rate_limit } : {}),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
