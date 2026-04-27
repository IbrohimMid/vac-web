// Command id → ack promise correlation.

export interface Ack {
  ackOf: string;
  ok: boolean;
  error?: { code: string; message: string };
}

type Entry = {
  resolve: (ack: Ack) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Default ack timeout for bridge-bound commands.
 *
 * Bumped from 30s to 90s in Stage X.5e follow-up: ACP agents (notably
 * `gemini --acp` on first launch when the OAuth cache is cold) take
 * 30–60s to finish their `initialize` handshake, and `session.create`
 * does not ack until the agent reports ready. The previous 30s ceiling
 * surfaced spurious `ack timeout: cmd_*` failures in the cockpit even
 * though the bridge eventually accepted the session. Callers that
 * genuinely want a tighter window can still override via the second
 * argument; tests pin the default explicitly so this can’t silently
 * regress.
 */
export const DEFAULT_ACK_TIMEOUT_MS = 90_000;

export class Correlator {
  private pending = new Map<string, Entry>();

  register(id: string, ttlMs: number = DEFAULT_ACK_TIMEOUT_MS): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ack timeout: ${id}`));
      }, ttlMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  resolve(ack: Ack): boolean {
    const entry = this.pending.get(ack.ackOf);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(ack.ackOf);
    entry.resolve(ack);
    return true;
  }

  disconnect(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('disconnected'));
    }
    this.pending.clear();
  }
}
