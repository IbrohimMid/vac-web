// RAF-batched per-session event queue drain.

import type { InboundFrame } from './ws';

type Handler = (frame: InboundFrame) => void;

interface EnqueueTarget {
  session_id?: string;
  type?: string;
}

export class EventQueue {
  private queues = new Map<string, InboundFrame[]>();
  private handlers = new Map<string, Set<Handler>>();
  private scheduled = false;
  private readonly maxPerSession = 200;

  enqueue(frame: InboundFrame): void {
    const sid = (frame as EnqueueTarget).session_id ?? '_global';
    const q = this.queues.get(sid) ?? [];
    q.push(frame);
    this.queues.set(sid, q);
    if (q.length > this.maxPerSession) {
      console.warn(`[queue] session ${sid} over cap; backpressure expected`);
    }
    this.scheduleDrain();
  }

  on(type: string, handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler);
    };
  }

  private scheduleDrain(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const raf =
      typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;
    raf(() => this.drain());
  }

  private drain(): void {
    for (const [sid, q] of this.queues) {
      const batch = q.splice(0, q.length);
      for (const frame of batch) {
        const type = (frame as EnqueueTarget).type;
        if (!type) continue;
        const set = this.handlers.get(type);
        if (set) set.forEach((h) => h(frame));
      }
      if (q.length === 0) this.queues.delete(sid);
    }
    this.scheduled = false;
    if (this.queues.size > 0) this.scheduleDrain();
  }
}
