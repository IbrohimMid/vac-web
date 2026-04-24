// Wire `system.capabilities` event → actions registry.

import { useActions, type ActionSpec } from '../../actions/registry';
import type { TransportHandle } from '../../transport';

interface CapabilitiesPayload {
  actions?: ActionSpec[];
  features?: string[];
}

export function registerCapabilitiesHandlers(transport: TransportHandle): () => void {
  return transport.on('system.capabilities', (ev) => {
    const p = ev.payload as CapabilitiesPayload | null;
    if (p?.actions) {
      useActions.getState().setActions(p.actions);
    }
  });
}
