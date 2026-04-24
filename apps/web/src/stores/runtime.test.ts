import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntime } from './runtime';

function reset() {
  useRuntime.setState({ jobs: new Map(), order: [], logs: new Map() });
}

describe('runtime store', () => {
  beforeEach(reset);

  it('upsert preserves order on re-upsert', () => {
    useRuntime.getState().upsert({ id: 'j1', kind: 'watcher', label: 'w', status: 'running', startedAt: 't' });
    useRuntime.getState().upsert({ id: 'j1', kind: 'watcher', label: 'w', status: 'succeeded', startedAt: 't' });
    expect(useRuntime.getState().order).toEqual(['j1']);
    expect(useRuntime.getState().jobs.get('j1')?.status).toBe('succeeded');
  });

  it('appendLog caps at 1000 lines', () => {
    for (let i = 0; i < 1100; i++) {
      useRuntime.getState().appendLog('j1', { ts: 't', stream: 'stdout', text: `line${i}` });
    }
    expect(useRuntime.getState().logs.get('j1')?.length).toBe(1000);
    expect(useRuntime.getState().logs.get('j1')?.[0]?.text).toBe('line100');
  });
});
