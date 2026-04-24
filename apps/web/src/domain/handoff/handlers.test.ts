// Merge semantics for handoff.upserted — a partial update (e.g. the `approve`
// emission that carries only `{status, signers}`) must not wipe title/tasks/pin.

import { beforeEach, describe, expect, it } from 'vitest';
import { registerHandoffHandlers } from './handlers';
import { useHandoff } from '../../stores/handoff';
import type { EventFrame, TransportHandle } from '../../transport';

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
        const l = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, l);
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
      ts: 't',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('handoff.upserted merge', () => {
  beforeEach(() => useHandoff.getState().clear());

  it('partial update preserves prior fields', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);

    emit('handoff.upserted', {
      packet_id: 'p1',
      title: 'Real title',
      target_profile: 'executor.code@1.0.0',
      status: 'pending_approval',
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          finding_ids: ['f1'],
          requires_approval_per_step: false,
          constraint: '',
        },
      ],
      pin: {
        worktree_digest: 'abc',
        base_sha: 'deadbeef',
        captured_at: 't',
        policy: 'strict',
        connector_snapshots: [],
      },
      signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
      required_signers: 2,
    });

    // Now emit partial update like the mock-engine approve does.
    emit('handoff.upserted', {
      packet_id: 'p1',
      status: 'approved',
      signers: [{ name: 'bob', role: 'approver', signed_at: 't2', reason: 'ok' }],
    });

    const packet = useHandoff.getState().packets.get('p1');
    expect(packet?.title).toBe('Real title');
    expect(packet?.tasks).toHaveLength(1);
    expect(packet?.pin.worktree_digest).toBe('abc');
    expect(packet?.required_signers).toBe(2);
    expect(packet?.status).toBe('approved');
    expect(packet?.signers.map((s) => s.name)).toEqual(['alice', 'bob']);

    off();
  });

  it('re-emitting same signer name does not duplicate', () => {
    const { t, emit } = mockTransport();
    const off = registerHandoffHandlers(t);
    emit('handoff.upserted', {
      packet_id: 'p1',
      signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
    });
    emit('handoff.upserted', {
      packet_id: 'p1',
      signers: [{ name: 'alice', role: 'author', signed_at: 't-newer' }],
    });
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(1);
    off();
  });
});
