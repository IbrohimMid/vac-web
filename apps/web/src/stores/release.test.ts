import { beforeEach, describe, expect, it } from 'vitest';
import { useRelease } from './release';

function reset() {
  useRelease.getState().clear();
}

describe('release store', () => {
  beforeEach(reset);

  it('upsertDeploy mirrors target summary', () => {
    useRelease.getState().setTargets([
      {
        id: 'staging',
        label: 'Staging',
        environment: 'staging',
        last_status: 'idle',
      },
    ]);
    useRelease.getState().upsertDeploy({
      id: 'd1',
      target_id: 'staging',
      commit: 'abc',
      status: 'deployed',
      started_at: 't1',
      finished_at: 't2',
    });
    const t = useRelease.getState().targets.get('staging');
    expect(t?.last_status).toBe('deployed');
    expect(t?.last_commit).toBe('abc');
    expect(t?.last_deployed_at).toBe('t2');
  });

  it('appendObservation caps at 200 entries', () => {
    for (let i = 0; i < 250; i++) {
      useRelease.getState().appendObservation({
        id: `o${i}`,
        target_id: 't',
        connector: 'sentry',
        severity: 'info',
        message: 'x',
        observed_at: 't',
      });
    }
    expect(useRelease.getState().observations.length).toBe(200);
    expect(useRelease.getState().observations[0]?.id).toBe('o50');
  });

  it('deployOrder preserves insertion order on re-upsert', () => {
    useRelease.getState().upsertDeploy({
      id: 'd1',
      target_id: 't',
      commit: 'a',
      status: 'deploying',
      started_at: 't',
    });
    useRelease.getState().upsertDeploy({
      id: 'd1',
      target_id: 't',
      commit: 'a',
      status: 'deployed',
      started_at: 't',
    });
    expect(useRelease.getState().deployOrder).toEqual(['d1']);
  });
});
