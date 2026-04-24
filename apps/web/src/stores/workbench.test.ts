import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkbench } from './workbench';

describe('workbench store', () => {
  beforeEach(() => useWorkbench.setState({ active: 'transcript' }));

  it('default tab is transcript', () => {
    expect(useWorkbench.getState().active).toBe('transcript');
  });

  it('select changes active', () => {
    useWorkbench.getState().select('approvals');
    expect(useWorkbench.getState().active).toBe('approvals');
  });
});
