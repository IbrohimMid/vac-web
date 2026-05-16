import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_CAP, auditEntriesForRequest, useAudit } from './audit';

describe('useAudit', () => {
  beforeEach(() => useAudit.setState({ entries: [] }));

  it('appends entries newest-first with auto id and ts', () => {
    useAudit.getState().append({ source: 'user', kind: 'user.approve', summary: 'a' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'b' });
    const list = useAudit.getState().entries;
    expect(list.map((e) => e.kind)).toEqual(['bridge.mutation.applied', 'user.approve']);
    expect(list[0]?.id).toMatch(/^audit-/);
    expect(typeof list[0]?.ts).toBe('number');
  });

  it('caps the buffer at AUDIT_CAP and drops the oldest', () => {
    for (let i = 0; i < AUDIT_CAP + 25; i += 1) {
      useAudit.getState().append({ source: 'system', kind: 'noise', summary: `n${i}` });
    }
    const list = useAudit.getState().entries;
    expect(list.length).toBe(AUDIT_CAP);
    // newest-first, so the first entry is the most recent append (n224).
    expect(list[0]?.summary).toBe(`n${AUDIT_CAP + 24}`);
    // and the oldest 25 entries (n0..n24) have been evicted.
    expect(list.find((e) => e.summary === 'n0')).toBeUndefined();
    expect(list.find((e) => e.summary === 'n24')).toBeUndefined();
  });

  it('preserves optional fields when provided and omits them otherwise', () => {
    useAudit.getState().append({
      source: 'bridge', kind: 'bridge.mutation.failed', summary: 's',
      requestId: 'req-1', status: 'failed', detail: 'EACCES',
    });
    useAudit.getState().append({ source: 'system', kind: 'boot', summary: 'ok' });
    const [first, second] = useAudit.getState().entries;
    expect(second?.requestId).toBe('req-1');
    expect(second?.status).toBe('failed');
    expect(second?.detail).toBe('EACCES');
    expect(first?.requestId).toBeUndefined();
    expect(first?.status).toBeUndefined();
    expect(first?.detail).toBeUndefined();
  });

  it('auditEntriesForRequest scopes entries to a single requestId', () => {
    useAudit.getState().append({ source: 'user', kind: 'user.approve', summary: 'a', requestId: 'req-1' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'b', requestId: 'req-2' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'c', requestId: 'req-1' });
    const list = auditEntriesForRequest(useAudit.getState(), 'req-1');
    expect(list.map((e) => e.summary)).toEqual(['c', 'a']);
  });

  it('clear() empties the buffer', () => {
    useAudit.getState().append({ source: 'system', kind: 'x', summary: 'y' });
    useAudit.getState().clear();
    expect(useAudit.getState().entries).toEqual([]);
  });
});
