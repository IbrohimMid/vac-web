import { beforeEach, describe, expect, it } from 'vitest';
import {
  mutationIntentList,
  useMutations,
  type MutationIntent,
} from './mutations';

function reset() {
  useMutations.setState({ intents: {}, order: [] });
}

function fixture(overrides: Partial<MutationIntent> = {}): MutationIntent {
  return {
    requestId: 'req-1',
    kind: 'write',
    summary: 'Create src/foo.ts',
    rationale: 'Adds new feature',
    targetPath: 'src/foo.ts',
    receivedAt: 1,
    status: 'pending',
    sourceEventType: 'bridge.mutation.requested',
    ...overrides,
  };
}

describe('mutations store', () => {
  beforeEach(reset);

  it('upsert inserts a new intent and tracks insertion order', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    useMutations.getState().upsert(fixture({ requestId: 'b' }));
    const list = mutationIntentList(useMutations.getState());
    expect(list.map((m) => m.requestId)).toEqual(['a', 'b']);
  });

  it('upsert with same requestId merges fields without duplicating order', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a', summary: 'old' }));
    useMutations.getState().upsert(fixture({ requestId: 'a', summary: 'new' }));
    const list = mutationIntentList(useMutations.getState());
    expect(list).toHaveLength(1);
    expect(list[0]?.summary).toBe('new');
    expect(useMutations.getState().order).toEqual(['a']);
  });

  it('upsert stamps statusUpdatedAt when omitted', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    expect(typeof useMutations.getState().intents['a']?.statusUpdatedAt).toBe('number');
  });

  it('setStatus updates an existing intent and refreshes statusUpdatedAt', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    const before = useMutations.getState().intents['a']?.statusUpdatedAt ?? 0;
    // Force a different tick so the assertion is non-flaky.
    const real = Date.now;
    Date.now = () => before + 1000;
    try {
      useMutations.getState().setStatus('a', 'approved', 'Looks good');
    } finally {
      Date.now = real;
    }
    const cur = useMutations.getState().intents['a'];
    expect(cur?.status).toBe('approved');
    expect(cur?.statusMessage).toBe('Looks good');
    expect((cur?.statusUpdatedAt ?? 0) > before).toBe(true);
  });

  it('setStatus preserves existing message when none supplied', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a', statusMessage: 'keep me' }));
    useMutations.getState().setStatus('a', 'approved');
    expect(useMutations.getState().intents['a']?.statusMessage).toBe('keep me');
  });

  it('setStatus on unknown requestId is a silent no-op', () => {
    useMutations.getState().setStatus('missing', 'approved');
    expect(Object.keys(useMutations.getState().intents)).toHaveLength(0);
    expect(useMutations.getState().order).toEqual([]);
  });

  it('remove drops the intent and its order entry', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    useMutations.getState().upsert(fixture({ requestId: 'b' }));
    useMutations.getState().remove('a');
    expect(useMutations.getState().order).toEqual(['b']);
    expect(useMutations.getState().intents['a']).toBeUndefined();
  });

  it('remove on unknown requestId is a silent no-op', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    useMutations.getState().remove('missing');
    expect(useMutations.getState().order).toEqual(['a']);
  });

  it('clear resets every field', () => {
    useMutations.getState().upsert(fixture({ requestId: 'a' }));
    useMutations.getState().upsert(fixture({ requestId: 'b' }));
    useMutations.getState().clear();
    expect(useMutations.getState().intents).toEqual({});
    expect(useMutations.getState().order).toEqual([]);
  });

  it('mutationIntentList ignores stale order entries with no intent body', () => {
    useMutations.setState({
      intents: { a: fixture({ requestId: 'a' }) },
      order: ['a', 'ghost'],
    });
    const list = mutationIntentList(useMutations.getState());
    expect(list.map((m) => m.requestId)).toEqual(['a']);
  });
});
