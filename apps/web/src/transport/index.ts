// Composed transport: WS + EventQueue + Correlator.

import { Correlator, type Ack } from './correlation';
import { EventQueue } from './queue';
import { ulid } from './ulid';
import {
  BridgeWs,
  isAckFrame,
  isWelcomeFrame,
  type AvailableAgent,
  type EventFrame,
  type InboundFrame,
} from './ws';

export * from './correlation';
export * from './queue';
export * from './ws';

export interface TransportHandle {
  send<P extends object>(sessionId: string, type: string, payload: P): Promise<Ack>;
  on(type: string, handler: (ev: EventFrame) => void): () => void;
  /// Snapshot of agents the bridge advertised in its welcome frame.
  /// Empty when the bridge is on a legacy single-agent build (no
  /// `available_agents` field) — callers should fall back to letting the
  /// bridge pick its implicit default.
  // Stage X.5e — optional so legacy stub transports (relay.ts, render
  // tests built before the multi-provider milestone) keep type-checking
  // without each having to fabricate a list. Live `createTransport`
  // implementations always provide it.
  availableAgents?(): AvailableAgent[];
  close(): void;
}

export async function createTransport(url: string): Promise<TransportHandle> {
  const queue = new EventQueue();
  const correlator = new Correlator();
  // Latest welcome frame's agent advertisement. Captured on connect AND
  // on every reconnect, so a bridge restart with a different fixture is
  // reflected before the next session.create.
  let availableAgents: AvailableAgent[] = [];

  const ws = new BridgeWs({
    url,
    onMessage: (frame: InboundFrame) => {
      if (isWelcomeFrame(frame)) {
        availableAgents = frame.available_agents ?? [];
        return;
      }
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
    availableAgents() {
      return availableAgents.slice();
    },
    close() {
      ws.close();
    },
  };
}
