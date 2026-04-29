// Real WebCrypto-grade E2E sealer.
//
// This module is intentionally separate from `e2e.ts` so it can be loaded via
// dynamic `import('./e2e-impl')` and split into its own chunk. The eager main
// bundle stays small even though @noble/* pulls in roughly ~30–40 KB of
// audited curve + AEAD code.
//
// Crypto choice rationale:
//   - X25519 ECDH + HKDF-SHA256 → 32-byte symmetric key. Standard pattern
//     used by libsodium's crypto_box, Signal, Wireguard. WebCrypto does not
//     yet ship X25519 broadly, so we use @noble/curves which is constant-time
//     and side-channel reviewed.
//   - XChaCha20-Poly1305 (24-byte nonce) lets us pick nonces randomly without
//     birthday-collision risk. We pull it from @noble/ciphers.
//
// Wire format (output of seal):
//   nonce (24 bytes) || ciphertext+tag (>= 16 bytes)
// open() returns null on any AEAD failure, never throws — callers treat null
// as 'drop frame' so a relay-injected/forged ciphertext cannot crash the
// session loop.

import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

import type { SealContext, Sealer } from './e2e';

const NONCE_BYTES = 24;

/** HKDF-SHA256 expand of an X25519 shared secret to a 32-byte AEAD key. */
function deriveSymmetricKey(ctx: SealContext): Uint8Array {
  const shared = x25519.getSharedSecret(ctx.ourPrivateKey, ctx.peerPublicKey);
  // 'vac-web/v1/relay-e2e' as the HKDF info ties the key to this protocol
  // version; rotating the string forces a re-key when the framing changes.
  const info = new TextEncoder().encode('vac-web/v1/relay-e2e');
  return hkdf(sha256, shared, ctx.sessionSalt, info, 32);
}

function randomNonce(): Uint8Array {
  const n = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(n);
  return n;
}

class XChaChaSealer implements Sealer {
  private readonly key: Uint8Array;

  constructor(key: Uint8Array) {
    this.key = key;
  }

  seal(plaintext: Uint8Array): Uint8Array {
    const nonce = randomNonce();
    const ct = xchacha20poly1305(this.key, nonce).encrypt(plaintext);
    const out = new Uint8Array(NONCE_BYTES + ct.length);
    out.set(nonce, 0);
    out.set(ct, NONCE_BYTES);
    return out;
  }

  open(framed: Uint8Array): Uint8Array | null {
    if (framed.length < NONCE_BYTES + 16) return null;
    const nonce = framed.subarray(0, NONCE_BYTES);
    const ct = framed.subarray(NONCE_BYTES);
    try {
      return xchacha20poly1305(this.key, nonce).decrypt(ct);
    } catch {
      return null;
    }
  }
}

/**
 * Build a real Sealer from a per-session SealContext. Idempotent—callers can
 * cache the returned object for the lifetime of the WS session.
 */
export function createX25519Sealer(ctx: SealContext): Sealer {
  if (ctx.peerPublicKey.length !== 32) {
    throw new Error('e2e: peerPublicKey must be 32 bytes');
  }
  if (ctx.ourPrivateKey.length !== 32) {
    throw new Error('e2e: ourPrivateKey must be 32 bytes');
  }
  if (ctx.sessionSalt.length === 0) {
    throw new Error('e2e: sessionSalt must be non-empty');
  }
  const key = deriveSymmetricKey(ctx);
  return new XChaChaSealer(key);
}

/**
 * Generate a fresh X25519 keypair for a new session. Useful for tests and
 * for the pairing handshake when the bridge has not yet pinned a key.
 */
export function generateKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}
