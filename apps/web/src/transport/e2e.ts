// E2E keypair channel — OPT-IN mode per `docs/plans/phase-7/README.md §7.6`.
//
// Shape: bridge and browser exchange X25519 pubkeys at pair time → derive a
// symmetric key (HKDF-SHA256) → seal/open payloads with XChaCha20-Poly1305.
// Relay sees ciphertext only.
//
// File layout:
//   - This module exposes the small interface (Sealer/SealContext) plus the
//     trivially-sized IdentitySealer / RejectingSealer used as canaries.
//   - The actual crypto lives in `./e2e-impl.ts` and is loaded via dynamic
//     `import()` so @noble/* lands in its own chunk and the eager main
//     bundle stays small.
//
// Mode contract:
//   - 'plain'  → IdentitySealer (round-trips bytes; relay terminates the WS).
//   - 'e2e'    → createE2eSealer(ctx) for real sealing. The synchronous
//                 `pickSealer` helper is kept for canary tests and returns a
//                 RejectingSealer when ctx is missing, so a misconfigured E2E
//                 path surfaces as an outage instead of a silent plaintext
//                 leak.

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
 * route frames through `seal`/`open` regardless of mode.
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
 * Stub that rejects frames — used as a canary so a broken E2E wiring surfaces
 * as an outage rather than silent plaintext leak.
 */
export class RejectingSealer implements Sealer {
  seal(_p: Uint8Array): Uint8Array {
    throw new Error('e2e sealer not initialized');
  }
  open(_c: Uint8Array): Uint8Array | null {
    return null;
  }
}

/**
 * Synchronous mode dispatch. Returns RejectingSealer for 'e2e' so existing
 * call sites stay safe even when the async crypto module has not been loaded
 * yet. Real E2E sessions must call `createE2eSealer` once the SealContext is
 * negotiated.
 */
export function pickSealer(mode: 'plain' | 'e2e', _ctx?: SealContext): Sealer {
  return mode === 'e2e' ? new RejectingSealer() : new IdentitySealer();
}

/**
 * Build a real X25519 + XChaCha20-Poly1305 sealer. Lazy-loads the crypto
 * implementation so @noble/* stays out of the eager main chunk.
 *
 * Throws if peer/our keys are not 32 bytes or sessionSalt is empty — the
 * caller is expected to surface that as a pairing failure, not a silent
 * downgrade.
 */
export async function createE2eSealer(ctx: SealContext): Promise<Sealer> {
  const mod = await import('./e2e-impl');
  return mod.createX25519Sealer(ctx);
}

/**
 * Generate a fresh X25519 keypair for a new session. Lazy-loads the crypto
 * implementation; intended for use during pairing handshake setup.
 */
export async function generateE2eKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const mod = await import('./e2e-impl');
  return mod.generateKeypair();
}
