import { describe, expect, it } from 'vitest';
import { filterActions } from './filterActions';
import type { ActionSpec } from './registry';
import type { Context } from './predicate';

const ctx: Context = {
  session: { open: true, streaming: false },
  workbench: { tab: 'transcript' },
  approvals: { pendingCount: 0 },
  gates: {},
};

const mk = (over: Partial<ActionSpec>): ActionSpec => ({
  id: 'a1',
  label: 'Default',
  description: '',
  group: 'Actions',
  palette_visible: true,
  required_capabilities: [],
  ...over,
});

describe('filterActions', () => {
  it('palette mode requires palette_visible true', () => {
    const acts = [
      mk({ id: 'visible', label: 'Visible', palette_visible: true }),
      mk({ id: 'hidden', label: 'Hidden', palette_visible: false }),
    ];
    const res = filterActions({ actions: acts, query: '', mode: 'palette', ctx });
    expect(res.map((r) => r.action.id)).toEqual(['visible']);
  });

  it('slash mode requires slash_alias non-empty', () => {
    const acts = [
      mk({ id: 'has-slash', label: 'Has Slash', slash_alias: '/foo' }),
      mk({ id: 'no-slash', label: 'No Slash' }),
      mk({ id: 'empty-slash', label: 'Empty', slash_alias: '' }),
    ];
    const res = filterActions({ actions: acts, query: '', mode: 'slash', ctx });
    expect(res.map((r) => r.action.id)).toEqual(['has-slash']);
  });

  it('slash mode matches the alias when label diverges', () => {
    const acts = [
      mk({ id: 'rtd', label: 'Run Ready-to-Deploy', slash_alias: '/assess-rtd' }),
    ];
    const res = filterActions({
      actions: acts,
      query: 'assess',
      mode: 'slash',
      ctx,
    });
    expect(res).toHaveLength(1);
  });

  it('non-matching query filters out (returns null score)', () => {
    const acts = [mk({ id: 'a', label: 'completely unrelated text' })];
    const res = filterActions({ actions: acts, query: 'zxqq', mode: 'palette', ctx });
    expect(res).toHaveLength(0);
  });

  it('predicate-blocked actions are kept with disabledReason', () => {
    const acts = [mk({ id: 'a', label: 'Locked', available_when: 'session.streaming' })];
    const res = filterActions({
      actions: acts,
      query: '',
      mode: 'palette',
      ctx, // session.streaming === false
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.disabledReason).toBeTruthy();
  });

  it('respects limit', () => {
    const acts = Array.from({ length: 50 }, (_, i) =>
      mk({ id: `a${i}`, label: `Item ${i}` }),
    );
    const res = filterActions({ actions: acts, query: '', mode: 'palette', ctx, limit: 10 });
    expect(res).toHaveLength(10);
  });

  it('empty query in palette mode returns all visible (sorted by recency-augmented score)', () => {
    const acts = [
      mk({ id: 'a', label: 'A' }),
      mk({ id: 'b', label: 'B' }),
      mk({ id: 'c', label: 'C', palette_visible: false }),
    ];
    const res = filterActions({ actions: acts, query: '', mode: 'palette', ctx });
    expect(res.map((r) => r.action.id).sort()).toEqual(['a', 'b']);
  });
});
