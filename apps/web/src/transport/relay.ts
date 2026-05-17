// Relay-aware transport variant. Wraps the inner vac-web envelope in a
// `{header, payload}` wire frame so the blind relay can route by
// `{device_id, session_id}` without inspecting payload.
//
// The relay's URL shape is `wss://relay.example.com/client/attach` with
// `?device_id=…&session_id=…&token=…[&last_event_id=…]` query parameters.

import { Correlator, type Ack } from './correlation';
import { EventQueue } from './queue';
import { ulid } from './ulid';
import {
  BridgeWs,
  isAckFrame,
  type AckFrame,
  type EventFrame,
  type InboundFrame,
} from './ws';
import type { TransportHandle } from '.';

export interface RelayParams {
  relayUrl: string;
  deviceId: string;
  sessionId: string;
  token: string;
  lastEventId?: number;
}

interface WireFrame {
  header: { session_id: string; seq: number; dir: 'to_client' | 'to_bridge' };
  payload: string;
}

export function buildRelayUrl(p: RelayParams): string {
  const u = new URL(p.relayUrl);
  // Accept both ws://host and wss://host/path forms; append route segment.
  const routePath = u.pathname.endsWith('/')
    ? `${u.pathname}client/attach`
    : `${u.pathname}/client/attach`;
  u.pathname = routePath;
  u.searchParams.set('device_id', p.deviceId);
  u.searchParams.set('session_id', p.sessionId);
  u.searchParams.set('token', p.token);
  if (typeof p.lastEventId === 'number') {
    u.searchParams.set('last_event_id', String(p.lastEventId));
  }
  return u.toString();
}

export async function createRelayTransport(p: RelayParams): Promise<TransportHandle> {
  const queue = new EventQueue();
  const correlator = new Correlator();
  let lastSeq = p.lastEventId ?? 0;

  const ws = new BridgeWs({
    url: buildRelayUrl(p),
    // Relay forwards opaque `{header, payload}` wire frames; the bridge
    // `hello` handshake (and its localStorage-backed bearer token) must
    // never traverse the relay WAN socket. See finding S10-F01.
    disableHelloAuth: true,
    // Rebuild the relay URL on every (re)connect so the bridge resumes
    // from the latest delivered `seq`. Without this, `BridgeWs` would
    // dial the original URL on reconnect and the bridge would replay
    // from `last_event_id=0`, silently dropping/duplicating events the
    // queue already saw. See finding S10-F02.
    urlProvider: () =>
      lastSeq > 0 ? buildRelayUrl({ ...p, lastEventId: lastSeq }) : buildRelayUrl(p),
    onMessage: (raw: InboundFrame) => {
      // Relay may forward bridge control frames un-wrapped (e.g. a
      // top-level `replay.out_of_range` notice when the requested
      // `last_event_id` is below the bridge's retention window). Route
      // these directly into the queue so a
      // `handle.on('replay.out_of_range', ...)` subscriber can surface
      // the hard-resync/session-stale state to the user. See finding
      // S10-F02.
      if (
        raw &&
        typeof raw === 'object' &&
        (raw as { type?: string }).type === 'replay.out_of_range'
      ) {
        queue.enqueue(raw as InboundFrame);
        return;
      }
      // Relay wraps inner frames; unwrap here before dispatching to handlers.
      const wire = raw as unknown as WireFrame;
      if (wire && wire.header && typeof wire.payload === 'string') {
        if (wire.header.seq > lastSeq) lastSeq = wire.header.seq;
        try {
          const inner = JSON.parse(wire.payload) as InboundFrame;
          if (isAckFrame(inner)) {
            correlator.resolve(inner as AckFrame);
            return;
          }
          queue.enqueue(inner);
        } catch {
          /* malformed payload — drop */
        }
      }
    },
    onClose: () => correlator.disconnect(),
  });

  await ws.connect();

  const wrap = (inner: unknown, sessionId: string, seq: number): WireFrame => ({
    header: { session_id: sessionId, seq, dir: 'to_bridge' },
    payload: JSON.stringify(inner),
  });

  return {
    async send(sessionId, type, payload): Promise<Ack> {
      const id = `cmd_${ulid()}`;
      const ack = correlator.register(id);
      const inner = { id, session_id: sessionId, type, payload, v: 1 };
      ws.send(wrap(inner, sessionId, 0) as unknown as object);
      return ack;
    },
    on(type, handler) {
      return queue.on(type, (frame) => {
        // `EventFrame` carries `seq`; the bridge also emits control
        // frames (currently only `replay.out_of_range`) that have no
        // `seq` but still need to reach the subscriber so the cockpit
        // can flip the session into a hard-resync/session-stale state.
        // See finding S10-F02.
        const f = frame as { seq?: number; type?: string };
        if (f.seq !== undefined || f.type === 'replay.out_of_range') {
          handler(frame as EventFrame);
        }
      });
    },
    close() {
      ws.close();
    },
  };
}

/** Exposed so reconnect logic can resume from the last-seen seq. */
export function parseRelayParamsFromLocation(): RelayParams | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const relayUrl = q.get('relay');
  const deviceId = q.get('device');
  const sessionId = q.get('session');
  const token = q.get('token');
  if (!relayUrl || !deviceId || !sessionId || !token) return null;
  const last = q.get('last_event_id');
  const res: RelayParams = { relayUrl, deviceId, sessionId, token };
  if (last && Number.isFinite(Number(last))) res.lastEventId = Number(last);
  return res;
}
