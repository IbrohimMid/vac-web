// Single WebSocket per tab; multiplex sessions via session_id.

import { clearAccessToken, getAccessToken } from './auth';

// ---- Discriminated frame types ----

export interface CommandFrame {
  id: string;
  session_id: string;
  type: string;
  payload: unknown;
  v: 1;
}

export interface EventFrame {
  seq: number;
  session_id: string;
  type: string;
  payload: unknown;
  v: 1;
  ts: string;
}

export interface AckFrame {
  ackOf: string;
  ok: boolean;
  error?: { code: string; message: string };
}

export interface WelcomeFrame {
  type: 'welcome';
  protocol_version: number;
  bridge_version: string;
  capabilities: string[];
}

export interface PingFrame {
  type: 'ping';
}

export interface ReplayOutOfRangeFrame {
  type: 'replay.out_of_range';
  session_id?: string;
  oldest?: number;
  requested?: number;
  lagged?: number;
}

/// Any frame received from the bridge.
export type InboundFrame =
  | EventFrame
  | AckFrame
  | WelcomeFrame
  | PingFrame
  | ReplayOutOfRangeFrame;

// Type guards for safe narrowing.
export function isAckFrame(f: unknown): f is AckFrame {
  return typeof f === 'object' && f !== null && 'ackOf' in f && typeof (f as AckFrame).ok === 'boolean';
}

export function isEventFrame(f: unknown): f is EventFrame {
  return (
    typeof f === 'object' &&
    f !== null &&
    'seq' in f &&
    'session_id' in f &&
    'type' in f &&
    'ts' in f
  );
}

export function isWelcomeFrame(f: unknown): f is WelcomeFrame {
  return typeof f === 'object' && f !== null && (f as { type?: string }).type === 'welcome';
}

// Legacy alias kept for consumers that don't narrow.
export type Envelope = InboundFrame;
export type EventHandler = (f: InboundFrame) => void;

export interface BridgeWsOptions {
  url: string;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onMessage?: EventHandler;
  onError?: (e: unknown) => void;
}

export class BridgeWs {
  private ws: WebSocket | null = null;
  private opts: BridgeWsOptions;
  private reconnectAttempts = 0;
  private readonly reconnectDelays = [1000, 2000, 5000, 10_000, 30_000];
  private closed = false;

  constructor(opts: BridgeWsOptions) {
    this.opts = opts;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        const hello: Record<string, unknown> = { type: 'hello', protocol_version: 1 };
        const token = getAccessToken();
        if (token) hello.auth = { access_token: token };
        ws.send(JSON.stringify(hello));
        this.opts.onOpen?.();
        resolve();
      };

      ws.onmessage = (evt) => {
        try {
          const parsed: unknown = JSON.parse(evt.data as string);
          if (typeof parsed === 'object' && parsed !== null) {
            // Detect bridge auth rejection (stale token from previous bridge
            // session). Clear the dead token and hard-reload so the app resets
            // to the pairing prompt — a soft close isn't enough because Vite
            // HMR preserves React state across bridge restarts.
            const f = parsed as Record<string, unknown>;
            if (
              'ackOf' in f &&
              f.ok === false &&
              typeof f.error === 'object' &&
              f.error !== null &&
              (f.error as Record<string, unknown>).code === 'auth.invalid_token'
            ) {
              clearAccessToken();
              this.closed = true; // prevent reconnect before reload
              ws.close();
              window.location.reload();
              return;
            }
            this.opts.onMessage?.(parsed as InboundFrame);
          }
        } catch (e) {
          this.opts.onError?.(e);
        }
      };

      ws.onerror = (e) => {
        this.opts.onError?.(e);
      };

      ws.onclose = (evt) => {
        this.opts.onClose?.(evt.code, evt.reason);
        if (!this.closed) this.scheduleReconnect();
        if (ws.readyState === WebSocket.CLOSED && this.reconnectAttempts === 0) {
          reject(new Error(`ws closed before open: ${evt.code}`));
        }
      };
    });
  }

  send(envelope: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws not open');
    }
    this.ws.send(JSON.stringify(envelope));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    const delay =
      this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)] ??
      30_000;
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.closed) {
        this.connect().catch(() => {
          /* next attempt scheduled in onclose */
        });
      }
    }, delay);
  }
}
