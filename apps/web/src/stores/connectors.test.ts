// Regression coverage for the React #185 / Zustand selector-stability bug
// the cockpit audit flagged on RunAssessmentDrawer.
//
// The crash root cause was a selector that returned `Array.from(...)`,
// producing a fresh array on every snapshot. Fix: keep selectors at the
// store-rooted ref level (Map / object), then derive arrays via useMemo in
// the component.
//
// This test locks the underlying store invariant: reading the same Map ref
// twice (with no intervening mutation) returns the same reference, so a
// `useConnectors((s) => s.items)` selector is stable for shallow-equality.

import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectors } from './connectors';

function reset() {
  useConnectors.setState({ items: new Map() });
}

describe('connectors store — selector stability', () => {
  beforeEach(reset);

  it('items Map ref is stable across reads when not mutated', () => {
    const a = useConnectors.getState().items;
    const b = useConnectors.getState().items;
    expect(a).toBe(b);
  });

  it('items Map ref changes when setAll is called (store-level mutation)', () => {
    const a = useConnectors.getState().items;
    useConnectors.getState().setAll([
      {
        id: 'gh',
        provider: 'github',
        label: 'GitHub',
        health: 'connected',
      },
    ]);
    const b = useConnectors.getState().items;
    expect(a).not.toBe(b);
  });

  it('upsert returns a new Map ref (immutable update)', () => {
    useConnectors.getState().setAll([
      { id: 'gh', provider: 'github', label: 'GitHub', health: 'connected' },
    ]);
    const a = useConnectors.getState().items;
    useConnectors.getState().upsert({
      id: 'no',
      provider: 'notion',
      label: 'Notion',
      health: 'connected',
    });
    const b = useConnectors.getState().items;
    expect(a).not.toBe(b);
    expect(b.size).toBe(2);
  });

  it('two consecutive Array.from on the same Map have stable element order', () => {
    useConnectors.getState().setAll([
      { id: 'gh', provider: 'github', label: 'GitHub', health: 'connected' },
      { id: 'no', provider: 'notion', label: 'Notion', health: 'connected' },
    ]);
    const m = useConnectors.getState().items;
    const a = Array.from(m.values()).map((c) => c.id);
    const b = Array.from(m.values()).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
