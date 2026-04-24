import { describe, expect, it } from 'vitest';
import { computeDiff, isStuck } from './assessmentDiff';
import type { Finding } from './assessment';

const mk = (
  identity_hash: string,
  run_id: string,
  severity: Finding['severity'] = 'medium',
): Finding => ({
  id: `${run_id}_${identity_hash}`,
  identity_hash,
  run_id,
  category: 'technical',
  subject: 's',
  check: 'c',
  severity,
  confidence: 0.8,
  title: `t ${identity_hash}`,
  summary: '',
  evidence_ids: [],
  emitted_at: 't',
});

describe('computeDiff', () => {
  it('resolved: in prev, absent in next', () => {
    const d = computeDiff([mk('a', 'r1')], []);
    expect(d.counts.resolved).toBe(1);
    expect(d.counts.new).toBe(0);
  });

  it('new: absent in prev, in next', () => {
    const d = computeDiff([], [mk('a', 'r2')]);
    expect(d.counts.new).toBe(1);
  });

  it('persistent: same severity', () => {
    const d = computeDiff([mk('a', 'r1', 'medium')], [mk('a', 'r2', 'medium')]);
    expect(d.counts.persistent).toBe(1);
    expect(d.counts.regressed).toBe(0);
  });

  it('regressed: severity increased', () => {
    const d = computeDiff([mk('a', 'r1', 'medium')], [mk('a', 'r2', 'high')]);
    expect(d.counts.regressed).toBe(1);
  });

  it('decreased severity counts as persistent (not regressed)', () => {
    const d = computeDiff([mk('a', 'r1', 'high')], [mk('a', 'r2', 'low')]);
    expect(d.counts.persistent).toBe(1);
    expect(d.counts.regressed).toBe(0);
  });
});

describe('isStuck', () => {
  it('false below 3 cycles', () => {
    expect(isStuck([5, 4])).toBe(false);
  });
  it('true on flat-or-rising 3 cycles', () => {
    expect(isStuck([5, 5, 5])).toBe(true);
    expect(isStuck([4, 5, 6])).toBe(true);
  });
  it('false on strictly-decreasing', () => {
    expect(isStuck([6, 5, 4])).toBe(false);
  });
  it('trailing window only: early progress ignored', () => {
    expect(isStuck([10, 3, 5, 5, 5])).toBe(true);
  });
});
