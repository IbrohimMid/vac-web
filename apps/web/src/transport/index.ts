// Composed transport: WS + EventQueue + Correlator.

import { Correlator, type Ack } from './correlation';
import { EventQueue } from './queue';
import { ulid } from './ulid';
import { BridgeWs, isAckFrame, type EventFrame, type InboundFrame } from './ws';

export * from './correlation';
export * from './queue';
export * from './ws';

export interface TransportHandle {
  send<P extends object>(sessionId: string, type: string, payload: P): Promise<Ack>;
  on(type: string, handler: (ev: EventFrame) => void): () => void;
  close(): void;
}

export async function createTransport(url: string): Promise<TransportHandle> {
  const queue = new EventQueue();
  const correlator = new Correlator();

  const ws = new BridgeWs({
    url,
    onMessage: (frame: InboundFrame) => {
      if (isAckFrame(frame)) {
        correlator.resolve(frame);
        return;
      }
      queue.enqueue(frame);
    },
    onClose: () => {
      correlator.disconnect();
    },
  });

  await ws.connect();

  return {
    async send(sessionId, type, payload) {
      const id = `cmd_${ulid()}`;
      const ack = correlator.register(id);
      ws.send({ id, session_id: sessionId, type, payload, v: 1 });
      return ack;
    },
    on(type, handler) {
      return queue.on(type, (frame) => {
        // Only forward event-shaped frames to typed handlers.
        if ((frame as EventFrame).seq !== undefined) {
          handler(frame as EventFrame);
        }
      });
    },
    close() {
      ws.close();
    },
  };
}
