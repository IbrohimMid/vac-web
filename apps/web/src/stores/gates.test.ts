import { beforeEach, describe, expect, it } from 'vitest';
import { useGates, type Gate } from './gates';

function reset() {
  useGates.getState().clear();
}

const baseGate: Gate = {
  id: 'DevComplete',
  state: 'open',
  summary: '',
  blockers: [],
  criteria: [],
  signers: [],
  required_signers: 1,
  overridden: false,
  last_changed_at: 't',
};

describe('gates store', () => {
  beforeEach(reset);

  it('upsert stores gate', () => {
    useGates.getState().upsert(baseGate);
    expect(useGates.getState().gates.get('DevComplete')?.state).toBe('open');
  });

  it('addSigner is idempotent by name', () => {
    useGates.getState().upsert(baseGate);
    useGates.getState().addSigner('DevComplete', 'alice');
    useGates.getState().addSigner('DevComplete', 'alice');
    expect(useGates.getState().gates.get('DevComplete')?.signers).toHaveLength(1);
  });

  it('override flips state to pass', () => {
    useGates.getState().upsert({ ...baseGate, state: 'fail' });
    useGates.getState().override('DevComplete', 'ship anyway');
    const g = useGates.getState().gates.get('DevComplete');
    expect(g?.state).toBe('pass');
    expect(g?.overridden).toBe(true);
    expect(g?.summary).toContain('ship anyway');
  });
});
