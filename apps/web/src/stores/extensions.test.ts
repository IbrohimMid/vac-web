import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportHandle } from '../transport';
import { useExtensions } from './extensions';

function reset() {
  useExtensions.getState().clear();
}

function mockTransport(send: TransportHandle['send']): TransportHandle {
  return {
    send,
    on: () => () => undefined,
    close: () => undefined,
  };
}

describe('extensions store', () => {
  beforeEach(reset);
  afterEach(reset);

  it('setSnapshot replaces entries and sets ready', () => {
    useExtensions.getState().setSnapshot({
      version: 1,
      allow_unsigned: false,
      publishers: ['pubA'],
      entries: [
        {
          id: 'ext-a',
          tier: 'allowed_bundled',
          source: 'bundled',
          publisher: null,
          decision: 'allowed_bundled',
        },
        {
          id: 'ext-b',
          tier: 'quarantined',
          source: 'signed',
          publisher: 'pubA',
          decision: 'quarantined',
        },
      ],
    });
    const s = useExtensions.getState();
    expect(s.version).toBe(1);
    expect(s.status).toBe('ready');
    expect(s.entries.size).toBe(2);
    expect(s.order).toEqual(['ext-a', 'ext-b']);
    expect(s.entries.get('ext-b')?.decision).toBe('quarantined');
  });

  it('upsertEntry mutates a known entry without reordering', () => {
    useExtensions.getState().setSnapshot({
      version: 1,
      allow_unsigned: false,
      publishers: [],
      entries: [
        {
          id: 'ext-a',
          tier: 'allowed_bundled',
          source: 'bundled',
          publisher: null,
          decision: 'allowed_bundled',
        },
      ],
    });
    useExtensions.getState().upsertEntry({
      id: 'ext-a',
      tier: 'quarantined',
      source: 'bundled',
      publisher: null,
      decision: 'quarantined',
    });
    const s = useExtensions.getState();
    expect(s.entries.get('ext-a')?.tier).toBe('quarantined');
    expect(s.order).toEqual(['ext-a']);
  });

  it('updateTrust dispatches extensions.update_trust on the transport', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd', ok: true }));
    const ok = await useExtensions
      .getState()
      .updateTrust(mockTransport(send), 'ext-x', 'revoked');
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith('', 'extensions.update_trust', {
      extension_id: 'ext-x',
      tier: 'revoked',
    });
  });
});
