// Wire `system.capabilities` event → actions registry.

import { useActions, type ActionSpec } from '../../actions/registry';
import { COMMAND_BY_ID, type CommandId, type CommandStatus } from '../../generated/commandCatalog';
import type { TransportHandle } from '../../transport';

interface CapabilitiesPayload {
  actions?: ActionSpec[];
  features?: string[];
}

const INSTALLABLE_STATUSES = new Set<CommandStatus>(['implemented']);

function statusDisabledReason(status: CommandStatus): string {
  switch (status) {
    case 'not_wired':
      return 'Bridge advertised this action, but the generated catalog marks it not wired.';
    case 'frontend_owned':
      return 'Frontend-owned actions must not be installed from bridge capabilities.';
    case 'protocol_only':
      return 'Protocol-only entries are event shapes, not executable actions.';
    case 'internal':
      return 'Internal commands are reserved for bridge/runtime use.';
    case 'deprecated':
      return 'Deprecated commands are not installed as executable actions.';
    case 'implemented':
      return '';
  }
}

export function catalogBackedCapabilityActions(actions: ActionSpec[]): ActionSpec[] {
  return actions.flatMap((action) => {
    const entry = COMMAND_BY_ID.get(action.id as CommandId);
    if (!entry) return [];
    if (!INSTALLABLE_STATUSES.has(entry.status)) return [];
    return [
      {
        ...action,
        source: action.source ?? 'vac',
        command_status: entry.status,
        command_scope: entry.scope,
        command_side_effect: entry.sideEffect,
        disabled_reason: statusDisabledReason(entry.status),
      },
    ];
  });
}

export function registerCapabilitiesHandlers(transport: TransportHandle): () => void {
  return transport.on('system.capabilities', (ev) => {
    const p = ev.payload as CapabilitiesPayload | null;
    if (p?.actions) {
      useActions.getState().setActions(catalogBackedCapabilityActions(p.actions));
    }
  });
}
