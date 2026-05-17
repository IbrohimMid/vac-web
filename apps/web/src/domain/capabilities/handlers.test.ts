import { beforeEach, describe, expect, it } from 'vitest';

import { useActions, type ActionSpec } from '../../actions/registry';
import type { EventFrame, TransportHandle } from '../../transport';
import { catalogBackedCapabilityActions, registerCapabilitiesHandlers } from './handlers';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, remaining);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = {
      seq: 1,
      session_id: 's',
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

const action = (id: string, label = id): ActionSpec => ({
  id,
  label,
  description: label,
  group: 'Test',
  palette_visible: true,
  required_capabilities: [],
});

describe('capabilities handlers', () => {
  beforeEach(() => {
    useActions.getState().clear();
  });

  it('installs only generated-catalog implemented actions from system.capabilities', () => {
    const safe = action('message.submit', 'Send message');
    const filtered = catalogBackedCapabilityActions([
      safe,
      action('system.capabilities', 'Protocol-only event'),
      action('review.revert_all', 'Not wired bulk revert'),
      action('overlay.dismiss', 'Frontend-owned dismiss'),
      action('stale.bridge.only', 'Unknown stale command'),
    ]);

    expect(filtered.map((a) => a.id)).toEqual(['message.submit']);
    expect(filtered[0]).toMatchObject({
      id: 'message.submit',
      source: 'vac',
      command_status: 'implemented',
      command_scope: 'session',
      command_side_effect: 'state',
    });
  });

  it('filters stale bridge payloads before updating the action registry', () => {
    const { t, emit } = mockTransport();
    const off = registerCapabilitiesHandlers(t);

    emit('system.capabilities', {
      actions: [
        action('session.close', 'Close session'),
        action('system.capabilities', 'Protocol-only event'),
        action('approval.approve_all', 'Stale bulk approve'),
        action('does.not.exist', 'Unknown stale action'),
      ],
      features: ['session'],
    });

    const actions = useActions.getState().actions;
    expect(actions.map((a) => a.id)).toEqual(['session.close']);
    expect(actions[0]?.command_status).toBe('implemented');

    off();
  });
});
