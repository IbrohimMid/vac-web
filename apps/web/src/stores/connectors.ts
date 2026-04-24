// Connector inventory store. Populated by `connector.list` + `connector.health`.

import { create } from 'zustand';

export type ConnectorHealth = 'connected' | 'degraded' | 'disconnected' | 'unknown';

export interface Connector {
  id: string;
  provider: string;
  label: string;
  health: ConnectorHealth;
  rateLimit?: { remaining: number; limit: number; reset_at: string };
  account?: string;
}

interface ConnectorsSlice {
  items: Map<string, Connector>;
  setAll(items: Connector[]): void;
  upsert(item: Connector): void;
  remove(id: string): void;
}

export const useConnectors = create<ConnectorsSlice>((set) => ({
  items: new Map(),
  setAll(items) {
    const m = new Map<string, Connector>();
    for (const c of items) m.set(c.id, c);
    set({ items: m });
  },
  upsert(item) {
    set((s) => {
      const items = new Map(s.items);
      items.set(item.id, item);
      return { items };
    });
  },
  remove(id) {
    set((s) => {
      const items = new Map(s.items);
      items.delete(id);
      return { items };
    });
  },
}));
