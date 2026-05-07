import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportHandle } from '../transport';
import { usePerf } from './perf';

function reset() {
  usePerf.getState().clear();
}

function mockTransport(send: TransportHandle['send']): TransportHandle {
  return {
    send,
    on: () => () => undefined,
    close: () => undefined,
  };
}

describe('perf store', () => {
  beforeEach(reset);
  afterEach(reset);

  it('starts idle with unknown status', () => {
    const s = usePerf.getState();
    expect(s.status).toBe('unknown');
    expect(s.requestStatus).toBe('idle');
    expect(s.latest).toBeNull();
    expect(s.regressions).toEqual([]);
  });

  it('setSnapshot replaces fields and flips to ready', () => {
    usePerf.getState().setSnapshot({
      status: 'ok',
      latest: {
        recorded_at: '2026-05-07T00:00:00Z',
        commit: 'abc',
        ref: 'refs/heads/main',
        run_id: '123',
        measurements: { startup: { p95_ms: 100 } },
      },
      regressions: [],
    });
    const s = usePerf.getState();
    expect(s.status).toBe('ok');
    expect(s.requestStatus).toBe('ready');
    expect(s.latest?.commit).toBe('abc');
    expect(s.lastUpdated).not.toBeNull();
  });

  it('requestLatest dispatches perf.latest_run sessionless', async () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    const transport = mockTransport(send as unknown as TransportHandle['send']);
    const ok = await usePerf.getState().requestLatest(transport);
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith('', 'perf.latest_run', {});
  });

  it('requestLatest reports error when ack fails', async () => {
    const send = vi.fn(async () => ({
      ackOf: 'x',
      ok: false,
      error: { code: 'fail', message: 'boom' },
    }));
    const transport = mockTransport(send as unknown as TransportHandle['send']);
    const ok = await usePerf.getState().requestLatest(transport);
    expect(ok).toBe(false);
    expect(usePerf.getState().requestStatus).toBe('error');
    expect(usePerf.getState().error).toBe('boom');
  });

  it('requestLatest with null transport sets error', async () => {
    const ok = await usePerf.getState().requestLatest(null);
    expect(ok).toBe(false);
    expect(usePerf.getState().requestStatus).toBe('error');
  });
});
