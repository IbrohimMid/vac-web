// Stage J prefill correctness — locks the union contract.
// Selected findings (the prefill from AssessmentReportDetail) MUST appear
// in the HandoffBuilder picker even when their run or severity wouldn't
// normally meet the eligibility filter.

import { describe, expect, it } from 'vitest';
import type { Finding, Severity } from '../../stores/assessment';
import { isCarryover, visibleHandoffFindings } from './visibleFindings';

const mk = (
  id: string,
  run_id: string,
  severity: Severity,
  title = id,
): Finding => ({
  id,
  identity_hash: id,
  run_id,
  category: 'technical',
  subject: '',
  check: '',
  severity,
  confidence: 0.8,
  title,
  summary: '',
  evidence_ids: [],
  emitted_at: 't',
});

describe('visibleHandoffFindings', () => {
  it('shows active-run medium+ findings (baseline)', () => {
    const all = [
      mk('a', 'r1', 'high'),
      mk('b', 'r1', 'medium'),
      mk('c', 'r1', 'low'), // below floor
      mk('d', 'r2', 'high'), // wrong run
    ];
    const visible = visibleHandoffFindings(all, 'r1', new Set());
    expect(visible.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('includes selected finding from a different run', () => {
    const all = [
      mk('a', 'r1', 'high'),
      mk('cross', 'r2', 'high'), // selected from another report
    ];
    const visible = visibleHandoffFindings(all, 'r1', new Set(['cross']));
    expect(visible.map((f) => f.id).sort()).toEqual(['a', 'cross']);
  });

  it('includes selected low-severity finding', () => {
    const all = [
      mk('hi', 'r1', 'high'),
      mk('lo', 'r1', 'low'), // would be below floor, but selected
    ];
    const visible = visibleHandoffFindings(all, 'r1', new Set(['lo']));
    expect(visible.map((f) => f.id).sort()).toEqual(['hi', 'lo']);
  });

  it('selected critical from elsewhere AND active medium both visible', () => {
    const all = [
      mk('cross-crit', 'r2', 'critical'),
      mk('local-med', 'r1', 'medium'),
      mk('local-low', 'r1', 'low'), // not selected, hidden
    ];
    const visible = visibleHandoffFindings(
      all,
      'r1',
      new Set(['cross-crit']),
    );
    expect(visible.map((f) => f.id).sort()).toEqual([
      'cross-crit',
      'local-med',
    ]);
  });

  it('no active run → all medium+ visible', () => {
    const all = [
      mk('a', 'r1', 'high'),
      mk('b', 'r2', 'medium'),
      mk('c', 'r3', 'low'),
    ];
    const visible = visibleHandoffFindings(all, null, new Set());
    expect(visible.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('orders by severity desc', () => {
    const all = [
      mk('lo', 'r1', 'medium'),
      mk('hi', 'r1', 'critical'),
      mk('mid', 'r1', 'high'),
    ];
    const visible = visibleHandoffFindings(all, 'r1', new Set());
    expect(visible.map((f) => f.id)).toEqual(['hi', 'mid', 'lo']);
  });

  it('dedupes (no double-emit when finding is both eligible AND selected)', () => {
    const all = [mk('a', 'r1', 'high')];
    const visible = visibleHandoffFindings(all, 'r1', new Set(['a']));
    expect(visible).toHaveLength(1);
  });
});

describe('isCarryover', () => {
  it('true for selected from a different run', () => {
    expect(
      isCarryover(mk('x', 'r2', 'high'), 'r1', new Set(['x'])),
    ).toBe(true);
  });

  it('true for selected below the medium floor', () => {
    expect(
      isCarryover(mk('x', 'r1', 'low'), 'r1', new Set(['x'])),
    ).toBe(true);
  });

  it('false for selected eligible finding (active run + medium+)', () => {
    expect(
      isCarryover(mk('x', 'r1', 'high'), 'r1', new Set(['x'])),
    ).toBe(false);
  });

  it('false when not selected', () => {
    expect(isCarryover(mk('x', 'r2', 'low'), 'r1', new Set())).toBe(false);
  });
});
