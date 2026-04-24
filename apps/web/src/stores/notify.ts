import { create } from 'zustand';
import type { Severity } from '../components/SeverityIcon';

export type Lane = 'transient' | 'persistent' | 'sticky';

export interface NotifyEntry {
  id: string;
  lane: Lane;
  severity: Severity;
  subsystem: string;
  title: string;
  message: string;
  actionId?: string;
  correlationId?: string;
  ts: string;
}

interface NotifySlice {
  transient: NotifyEntry[];
  persistent: NotifyEntry[];
  sticky: Map<string, NotifyEntry>;
  receive(ev: NotifyEntry): void;
  dismiss(id: string): void;
}

const TRANSIENT_TTL_MS = 5000;

export const useNotify = create<NotifySlice>((set, get) => ({
  transient: [],
  persistent: [],
  sticky: new Map(),

  receive(ev) {
    if (ev.lane === 'transient') {
      set((s) => ({ transient: [ev, ...s.transient].slice(0, 5) }));
      setTimeout(() => get().dismiss(ev.id), TRANSIENT_TTL_MS);
    } else if (ev.lane === 'persistent') {
      set((s) => ({ persistent: [ev, ...s.persistent].slice(0, 200) }));
    } else {
      set((s) => {
        const sticky = new Map(s.sticky);
        sticky.set(ev.correlationId ?? ev.id, ev);
        return { sticky };
      });
    }
  },

  dismiss(id) {
    set((s) => ({
      transient: s.transient.filter((e) => e.id !== id),
      persistent: s.persistent.filter((e) => e.id !== id),
      sticky: (() => {
        const m = new Map(s.sticky);
        for (const [k, v] of m) {
          if (v.id === id) m.delete(k);
        }
        return m;
      })(),
    }));
  },
}));
