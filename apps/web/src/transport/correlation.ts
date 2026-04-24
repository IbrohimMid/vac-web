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

export class Correlator {
  private pending = new Map<string, Entry>();

  register(id: string, ttlMs = 30_000): Promise<Ack> {
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
