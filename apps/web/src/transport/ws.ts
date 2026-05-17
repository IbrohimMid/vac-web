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

/// Lightweight per-agent advertisement, mirrors `AvailableAgent` in
/// `apps/local-bridge/src/ws/envelope.rs`. Only enabled agents are
/// surfaced; exactly one entry has `default: true` (matching the
/// fixture's `default_agent`).
///
/// Stage X.5e adds optional `installed` and `install_hint`. Older
/// bridges that predate the field omit them; consumers must treat
/// `installed === undefined` as "unknown" (not "not installed").
export interface AvailableAgent {
  id: string;
  label: string;
  kind: string;
  default: boolean;
  /// PATH-based install probe at welcome time. Optional for forward
  /// compatibility with older bridges. `false` means the agent's
  /// command isn't on PATH and the cockpit should warn the operator.
  installed?: boolean;
  /// Free-form install/auth hint surfaced by the bridge fixture.
  /// Rendered verbatim by the cockpit when `installed === false`.
  install_hint?: string;
  /// Sprint 4 (MCP pass-through). Per-agent MCP server advertisement.
  /// Bridge skips the field entirely when no MCP servers are configured
  /// for the agent, so older bridges that pre-date the field send
  /// `mcp_servers === undefined` — consumers must default to an empty
  /// list rather than null-pun.
  mcp_servers?: AvailableAgentMcpServer[];
}

/// Sprint 4 frontend summary of one MCP server attached to an agent.
/// Mirrors `apps/local-bridge/src/ws/envelope.rs::McpServerAdvert` 1:1
/// — name-only for now; command/args/env are deliberately not surfaced
/// on the wire to keep the registry payload small.
export interface AvailableAgentMcpServer {
  name: string;
}

export interface WelcomeFrame {
  type: 'welcome';
  protocol_version: number;
  bridge_version: string;
  capabilities: string[];
  /// Optional. Older bridges (single-binary shim) omit this list; the
  /// cockpit then falls back to the legacy implicit-default behavior.
  available_agents?: AvailableAgent[];
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
  /// When true, suppress the local-bridge `hello` handshake (and the
  /// localStorage-backed `access_token` it carries). Required for the
  /// relay socket: relay is blind to bridge protocol and the bridge
  /// bearer token must never traverse the WAN. See finding S10-F01.
  disableHelloAuth?: boolean;
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
        if (!this.opts.disableHelloAuth) {
          const hello: Record<string, unknown> = { type: 'hello', protocol_version: 1 };
          const token = getAccessToken();
          if (token) hello.auth = { access_token: token };
          ws.send(JSON.stringify(hello));
        }
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
              !this.opts.disableHelloAuth &&
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
