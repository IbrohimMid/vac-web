import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Correlator, DEFAULT_ACK_TIMEOUT_MS } from './correlation';

describe('Correlator ack timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a 90s default so cold ACP boots dont surface spurious timeouts', () => {
    // Pin the constant so a future PR cant silently lower it back to 30s
    // and re-introduce the `ack timeout: cmd_*` regression that Stage
    // X.5e was meant to absorb.
    expect(DEFAULT_ACK_TIMEOUT_MS).toBe(90_000);
  });

  it('rejects with `ack timeout: <id>` once the default ttl elapses', async () => {
    const c = new Correlator();
    const p = c.register('cmd_1');
    // 89.999s passes → still pending.
    vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS - 1);
    let rejected = false;
    p.catch(() => {
      rejected = true;
    });
    await Promise.resolve();
    expect(rejected).toBe(false);
    // Cross the boundary → the pending entry is dropped and the promise
    // rejects with the bridge-correlated id in the message so error
    // surfaces can identify which command failed.
    vi.advanceTimersByTime(1);
    await expect(p).rejects.toThrow('ack timeout: cmd_1');
  });

  it('honors an explicit ttl override (callers can still tighten the window)', async () => {
    const c = new Correlator();
    const p = c.register('cmd_2', 100);
    vi.advanceTimersByTime(99);
    let rejected = false;
    p.catch(() => {
      rejected = true;
    });
    await Promise.resolve();
    expect(rejected).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(p).rejects.toThrow('ack timeout: cmd_2');
  });

  it('resolve() short-circuits the timer so a fast ack does not later reject', async () => {
    const c = new Correlator();
    const p = c.register('cmd_3');
    expect(c.resolve({ ackOf: 'cmd_3', ok: true })).toBe(true);
    await expect(p).resolves.toEqual({ ackOf: 'cmd_3', ok: true });
    // Advancing past the default ttl after a successful resolve must
    // not throw an unhandled rejection — the timer was cleared.
    vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT_MS + 1_000);
    // Resolving an unknown ack returns false rather than throwing.
    expect(c.resolve({ ackOf: 'cmd_3', ok: true })).toBe(false);
  });

  it('disconnect() cancels every pending entry with a `disconnected` error', async () => {
    const c = new Correlator();
    const p1 = c.register('cmd_a');
    const p2 = c.register('cmd_b');
    c.disconnect();
    await expect(p1).rejects.toThrow('disconnected');
    await expect(p2).rejects.toThrow('disconnected');
  });
});
