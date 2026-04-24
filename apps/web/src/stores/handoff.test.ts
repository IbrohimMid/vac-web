import { beforeEach, describe, expect, it } from 'vitest';
import { useHandoff, type Packet } from './handoff';

function reset() {
  useHandoff.getState().clear();
}

const basePacket: Packet = {
  id: 'p1',
  title: 't',
  target_profile: 'executor.code@1.0.0',
  status: 'pending_approval',
  tasks: [],
  pin: {
    worktree_digest: 'd',
    base_sha: 's',
    captured_at: 't',
    policy: 'strict',
    connector_snapshots: [],
  },
  signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
  required_signers: 2,
  convergence_count: 0,
  created_at: 't',
  updated_at: 't',
};

describe('handoff store', () => {
  beforeEach(reset);

  it('upsert first packet becomes active', () => {
    useHandoff.getState().upsert(basePacket);
    expect(useHandoff.getState().activePacketId).toBe('p1');
  });

  it('addSigner rejects self-sign (idempotent by name)', () => {
    useHandoff.getState().upsert(basePacket);
    const ok = useHandoff
      .getState()
      .addSigner('p1', { name: 'alice', role: 'approver', signed_at: 't2' });
    expect(ok).toBe(false);
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(1);
  });

  it('addSigner accepts distinct second signer', () => {
    useHandoff.getState().upsert(basePacket);
    const ok = useHandoff
      .getState()
      .addSigner('p1', { name: 'bob', role: 'approver', signed_at: 't2' });
    expect(ok).toBe(true);
    expect(useHandoff.getState().packets.get('p1')?.signers).toHaveLength(2);
  });

  it('setStatus updates status + timestamp', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().setStatus('p1', 'invalidated');
    expect(useHandoff.getState().packets.get('p1')?.status).toBe('invalidated');
  });

  it('incrementConvergence bumps counter', () => {
    useHandoff.getState().upsert(basePacket);
    useHandoff.getState().incrementConvergence('p1');
    useHandoff.getState().incrementConvergence('p1');
    expect(useHandoff.getState().packets.get('p1')?.convergence_count).toBe(2);
  });
});
