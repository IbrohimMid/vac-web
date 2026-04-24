import { describe, expect, it } from 'vitest';
import { buildRelayUrl } from './relay';
import { IdentitySealer, RejectingSealer, pickSealer } from './e2e';

describe('buildRelayUrl', () => {
  it('appends /client/attach + all query params', () => {
    const u = buildRelayUrl({
      relayUrl: 'wss://relay.example.com',
      deviceId: 'dev1',
      sessionId: 'sess1',
      token: 'tok_abc',
    });
    expect(u).toContain('/client/attach');
    expect(u).toContain('device_id=dev1');
    expect(u).toContain('session_id=sess1');
    expect(u).toContain('token=tok_abc');
  });

  it('includes last_event_id when provided', () => {
    const u = buildRelayUrl({
      relayUrl: 'wss://relay.example.com',
      deviceId: 'd',
      sessionId: 's',
      token: 't',
      lastEventId: 42,
    });
    expect(u).toContain('last_event_id=42');
  });

  it('omits last_event_id when undefined', () => {
    const u = buildRelayUrl({
      relayUrl: 'wss://relay.example.com',
      deviceId: 'd',
      sessionId: 's',
      token: 't',
    });
    expect(u).not.toContain('last_event_id');
  });
});

describe('e2e sealer', () => {
  it('plain mode is identity (round-trips bytes)', () => {
    const s = pickSealer('plain');
    const buf = new Uint8Array([1, 2, 3, 4]);
    const sealed = s.seal(buf);
    const opened = s.open(sealed);
    expect(opened).toEqual(buf);
  });

  it('IdentitySealer returns input unchanged', () => {
    const s = new IdentitySealer();
    const buf = new Uint8Array([9]);
    expect(s.seal(buf)).toEqual(buf);
  });

  it('e2e mode rejects until real crypto lands (canary)', () => {
    const s = pickSealer('e2e');
    expect(() => s.seal(new Uint8Array([1]))).toThrow(/not initialized/);
    expect(s.open(new Uint8Array([1]))).toBeNull();
  });

  it('RejectingSealer.open returns null', () => {
    expect(new RejectingSealer().open(new Uint8Array())).toBeNull();
  });
});
