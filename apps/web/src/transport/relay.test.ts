import { describe, expect, it } from 'vitest';
import { buildRelayUrl, createRelayTransport } from './relay';
import {
  IdentitySealer,
  RejectingSealer,
  pickSealer,
  createE2eSealer,
  generateE2eKeypair,
} from './e2e';

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

describe('e2e X25519 + XChaCha20-Poly1305 sealer', () => {
  it('round-trips a payload between two parties', async () => {
    const alice = await generateE2eKeypair();
    const bob = await generateE2eKeypair();
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const aliceSealer = await createE2eSealer({
      ourPrivateKey: alice.privateKey,
      peerPublicKey: bob.publicKey,
      sessionSalt: salt,
    });
    const bobSealer = await createE2eSealer({
      ourPrivateKey: bob.privateKey,
      peerPublicKey: alice.publicKey,
      sessionSalt: salt,
    });

    const plaintext = new TextEncoder().encode('hello relay');
    const sealed = aliceSealer.seal(plaintext);
    expect(sealed).not.toEqual(plaintext); // ciphertext is distinct
    expect(sealed.length).toBeGreaterThan(plaintext.length); // includes nonce + tag

    const opened = bobSealer.open(sealed);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe('hello relay');
  });

  it('rejects tampered ciphertext (returns null)', async () => {
    const alice = await generateE2eKeypair();
    const bob = await generateE2eKeypair();
    const salt = new Uint8Array([9, 9, 9]);

    const aliceSealer = await createE2eSealer({
      ourPrivateKey: alice.privateKey,
      peerPublicKey: bob.publicKey,
      sessionSalt: salt,
    });
    const bobSealer = await createE2eSealer({
      ourPrivateKey: bob.privateKey,
      peerPublicKey: alice.publicKey,
      sessionSalt: salt,
    });

    const sealed = aliceSealer.seal(new Uint8Array([1, 2, 3, 4]));
    // Flip a byte in the AEAD tag region.
    const lastIdx = sealed.length - 1;
    sealed[lastIdx] = (sealed[lastIdx] ?? 0) ^ 0xff;
    expect(bobSealer.open(sealed)).toBeNull();
  });

  it('rejects ciphertext from a wrong peer key (returns null)', async () => {
    const alice = await generateE2eKeypair();
    const bob = await generateE2eKeypair();
    const eve = await generateE2eKeypair();
    const salt = new Uint8Array([7, 7, 7]);

    const aliceSealer = await createE2eSealer({
      ourPrivateKey: alice.privateKey,
      peerPublicKey: bob.publicKey,
      sessionSalt: salt,
    });
    const eveSealer = await createE2eSealer({
      ourPrivateKey: eve.privateKey,
      peerPublicKey: alice.publicKey,
      sessionSalt: salt,
    });

    const sealed = aliceSealer.seal(new Uint8Array([42]));
    expect(eveSealer.open(sealed)).toBeNull();
  });

  it('rejects undersized framed input (returns null, no throw)', async () => {
    const alice = await generateE2eKeypair();
    const bob = await generateE2eKeypair();
    const sealer = await createE2eSealer({
      ourPrivateKey: alice.privateKey,
      peerPublicKey: bob.publicKey,
      sessionSalt: new Uint8Array([1]),
    });
    expect(sealer.open(new Uint8Array(8))).toBeNull();
  });

  it('refuses contexts with wrong key sizes', async () => {
    await expect(
      createE2eSealer({
        ourPrivateKey: new Uint8Array(16),
        peerPublicKey: new Uint8Array(32),
        sessionSalt: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe('createRelayTransport hello suppression (S10-F01)', () => {
  it('never sends bridge hello or access_token over the relay socket', async () => {
    localStorage.setItem('vac_web_access_token', 'bridge-secret-leak-canary');

    const sent: string[] = [];
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      onopen: ((e?: unknown) => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onclose: ((e: { code: number; reason: string }) => void) | null = null;
      constructor(public url: string) {
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.();
        }, 0);
      }
      send(data: string): void {
        sent.push(data);
      }
      close(): void {
        this.readyState = MockWebSocket.CLOSED;
      }
    }

    const originalWs = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    try {
      const handle = await createRelayTransport({
        relayUrl: 'wss://relay.example.com',
        deviceId: 'dev1',
        sessionId: 'sess1',
        token: 'relay-token-ok',
      });

      // Strict: the relay socket must send nothing on open. The bridge
      // hello (and any bearer token it carries) must never leak.
      expect(sent).toEqual([]);
      for (const frame of sent) {
        expect(frame).not.toContain('access_token');
        expect(frame).not.toContain('bridge-secret-leak-canary');
        expect(frame).not.toContain('"type":"hello"');
      }

      handle.close();
    } finally {
      (globalThis as unknown as { WebSocket: typeof globalThis.WebSocket }).WebSocket = originalWs;
      localStorage.removeItem('vac_web_access_token');
    }
  });
});
