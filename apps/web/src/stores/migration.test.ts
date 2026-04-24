import { beforeEach, describe, expect, it } from 'vitest';
import { canDispatchMigration, useMigration, type MigrationPacket } from './migration';

function reset() {
  useMigration.getState().clear();
}

const mkPacket = (overrides: Partial<MigrationPacket> = {}): MigrationPacket => ({
  id: 'mig1',
  title: 't',
  forward_sql: 'SELECT 1',
  rollback_sql: 'SELECT 1',
  phase: 'draft',
  maintenance_start: '2026-04-24T10:00:00Z',
  maintenance_end: '2026-04-24T11:00:00Z',
  dry_run_log: [],
  signers: [],
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

describe('migration store', () => {
  beforeEach(reset);

  it('addSigner rejects self-sign (author re-adding as approver)', () => {
    useMigration.getState().upsert(
      mkPacket({
        signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
      }),
    );
    const ok = useMigration.getState().addSigner('mig1', 'alice', 'approver');
    expect(ok).toBe(false);
    expect(useMigration.getState().packets.get('mig1')?.signers).toHaveLength(1);
  });

  it('addSigner accepts distinct approver', () => {
    useMigration.getState().upsert(
      mkPacket({
        signers: [{ name: 'alice', role: 'author', signed_at: 't' }],
      }),
    );
    const ok = useMigration.getState().addSigner('mig1', 'bob', 'approver');
    expect(ok).toBe(true);
    expect(useMigration.getState().packets.get('mig1')?.signers).toHaveLength(2);
  });

  it('upsert merges partial fields (phase-only update keeps prior sql)', () => {
    useMigration.getState().upsert(mkPacket({ forward_sql: 'ORIGINAL' }));
    // Partial-update shape: only id + phase, simulating what a bridge
    // `migration.status` emission would send.
    useMigration.getState().upsert({
      id: 'mig1',
      phase: 'scheduled',
    } as unknown as MigrationPacket);
    const p = useMigration.getState().packets.get('mig1');
    expect(p?.phase).toBe('scheduled');
    expect(p?.forward_sql).toBe('ORIGINAL');
  });

  it('appendDryRunLog caps at 500 lines', () => {
    useMigration.getState().upsert(mkPacket());
    for (let i = 0; i < 600; i++) {
      useMigration.getState().appendDryRunLog('mig1', `line${i}`);
    }
    const log = useMigration.getState().packets.get('mig1')?.dry_run_log ?? [];
    expect(log.length).toBe(500);
    expect(log[0]).toBe('line100');
  });
});

describe('canDispatchMigration', () => {
  const inWindow = new Date('2026-04-24T10:30:00Z');
  const outWindow = new Date('2026-04-24T12:00:00Z');

  it('false when phase not scheduled/awaiting_signoff', () => {
    const p = mkPacket({ phase: 'draft' });
    expect(canDispatchMigration(p, inWindow)).toBe(false);
  });

  it('false when reversibility not proven', () => {
    const p = mkPacket({
      phase: 'scheduled',
      reversibility_ok: false,
      signers: [
        { name: 'a', role: 'author', signed_at: 't' },
        { name: 'b', role: 'approver', signed_at: 't' },
      ],
    });
    expect(canDispatchMigration(p, inWindow)).toBe(false);
  });

  it('false when outside maintenance window', () => {
    const p = mkPacket({
      phase: 'scheduled',
      reversibility_ok: true,
      signers: [
        { name: 'a', role: 'author', signed_at: 't' },
        { name: 'b', role: 'approver', signed_at: 't' },
      ],
    });
    expect(canDispatchMigration(p, outWindow)).toBe(false);
    expect(canDispatchMigration(p, inWindow)).toBe(true);
  });

  it('false when two-party not satisfied', () => {
    const p = mkPacket({
      phase: 'scheduled',
      reversibility_ok: true,
      signers: [{ name: 'a', role: 'author', signed_at: 't' }],
    });
    expect(canDispatchMigration(p, inWindow)).toBe(false);
  });
});
