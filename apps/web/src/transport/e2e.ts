// E2E keypair channel — OPT-IN mode per `docs/plans/phase-7/README.md §7.6`.
//
// Shape: bridge and browser exchange X25519 pubkeys at pair time → derive a
// symmetric key → seal/open payloads with XChaCha20-Poly1305. Relay sees
// ciphertext only.
//
// This scaffold defines the plaintext/ciphertext wrapping interface so higher
// layers (relay.ts + bridge dial) can adopt it behind a feature flag. The
// actual crypto lands with WebCrypto-backed implementations in a 7.6.1
// hotfix; the interface here is what the audit pack targets.

export interface SealContext {
  /** Public key of the peer, as raw 32 bytes. */
  peerPublicKey: Uint8Array;
  /** Our private key for this session (never leaves the process). */
  ourPrivateKey: Uint8Array;
  /** Per-session salt mixed into key derivation. */
  sessionSalt: Uint8Array;
}

export interface Sealer {
  seal(plaintext: Uint8Array): Uint8Array;
  open(ciphertext: Uint8Array): Uint8Array | null;
}

/**
 * Plain-mode sealer: identity transform. Kept here so callers can uniformly
 * route frames through `seal`/`open` regardless of mode; swap this out for a
 * real XChaCha20-Poly1305 impl without touching consumers.
 */
export class IdentitySealer implements Sealer {
  seal(p: Uint8Array): Uint8Array {
    return p;
  }
  open(c: Uint8Array): Uint8Array | null {
    return c;
  }
}

/**
 * Stub that rejects frames — used as a canary in tests so a broken E2E wiring
 * surfaces as an outage rather than silent plaintext leak.
 */
export class RejectingSealer implements Sealer {
  seal(_p: Uint8Array): Uint8Array {
    throw new Error('e2e sealer not initialized');
  }
  open(_c: Uint8Array): Uint8Array | null {
    return null;
  }
}

export function pickSealer(mode: 'plain' | 'e2e', _ctx?: SealContext): Sealer {
  // TODO(7.6.1): wire WebCrypto X25519 + XChaCha20-Poly1305 when `mode==='e2e'`.
  // Until the real impl lands, E2E mode intentionally rejects so it's never
  // silently downgraded to plaintext.
  return mode === 'e2e' ? new RejectingSealer() : new IdentitySealer();
}
