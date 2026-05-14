// Wire workspace.preview.* events -> usePreview store, plus outbound
// request helpers with a truthful unsupported timeout fallback.
//
// Phase 4 is frontend-only: the bridge may not implement preview events yet.
// These handlers let the UI render real preview state when the bridge catches
// up, while timing out to an honest unsupported state when it stays silent.

import { usePreview, type PreviewStatus } from '../../stores/preview';
import type { PreviewConsoleError, PreviewNetworkFailure } from '../../stores/preview';
import type { TransportHandle } from '../../transport';

interface PreviewUpdatedPayload {
  session_id?: string;
  status?: string;
  url?: string | null;
}

interface PreviewUnsupportedPayload {
  session_id?: string;
  reason?: string;
}

interface PreviewErrorPayload {
  session_id?: string;
  message?: string;
}

interface PreviewConsoleErrorPayload {
  session_id?: string;
  message?: string;
  source?: string;
  line?: number;
}

interface PreviewNetworkFailurePayload {
  session_id?: string;
  url?: string;
  status?: number;
  message?: string;
}

export interface PreviewViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number | undefined;
}

export interface PreviewContextPayload {
  session_id?: string;
  url: string;
  console_errors?: PreviewConsoleError[] | undefined;
  network_failures?: PreviewNetworkFailure[] | undefined;
  viewport?: PreviewViewport | undefined;
  screenshot_data_url?: string | undefined;
}

type TimerHandle = unknown;

interface RequestOpts {
  timeoutMs?: number;
  setTimer?: (cb: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export const PREVIEW_OPEN_TIMEOUT_MS = 8000;
export const PREVIEW_REFRESH_TIMEOUT_MS = 4000;
const PREVIEW_TIMEOUT_REASON = 'no response from bridge within timeout';

function isPreviewStatus(raw: string | undefined): raw is PreviewStatus {
  return (
    raw === 'idle' ||
    raw === 'starting' ||
    raw === 'running' ||
    raw === 'failed' ||
    raw === 'stopped' ||
    raw === 'unsupported'
  );
}

function getTimers(opts: RequestOpts, fallbackMs: number) {
  return {
    timeoutMs: opts.timeoutMs ?? fallbackMs,
    setTimer: opts.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms)),
    clearTimer: opts.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>)),
  };
}

async function sendPreviewEvent<P extends { session_id?: string }>(
  transport: TransportHandle,
  sessionId: string,
  type: string,
  payload: P,
): Promise<void> {
  await transport.send(sessionId, type, payload);
}

export function registerPreviewHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('workspace.preview.updated', (ev) => {
      const p = (ev.payload ?? {}) as PreviewUpdatedPayload;
      if (!isPreviewStatus(p.status)) return;
      usePreview.getState().setUpdated({ status: p.status, url: p.url });
    }),
  );

  offs.push(
    transport.on('workspace.preview.unsupported', (ev) => {
      const p = (ev.payload ?? {}) as PreviewUnsupportedPayload;
      usePreview.getState().setUnsupported(p.reason ?? null);
    }),
  );

  offs.push(
    transport.on('workspace.preview.error', (ev) => {
      const p = (ev.payload ?? {}) as PreviewErrorPayload;
      usePreview.getState().setError(p.message ?? 'unknown error');
    }),
  );

  offs.push(
    transport.on('workspace.preview.console_error', (ev) => {
      const p = (ev.payload ?? {}) as PreviewConsoleErrorPayload;
      if (typeof p.message !== 'string' || p.message.length === 0) return;
      usePreview.getState().appendConsoleError({
        message: p.message,
        source: typeof p.source === 'string' ? p.source : undefined,
        line: typeof p.line === 'number' ? p.line : undefined,
      });
    }),
  );

  offs.push(
    transport.on('workspace.preview.network_failure', (ev) => {
      const p = (ev.payload ?? {}) as PreviewNetworkFailurePayload;
      if (typeof p.url !== 'string' || p.url.length === 0) return;
      usePreview.getState().appendNetworkFailure({
        url: p.url,
        status: typeof p.status === 'number' ? p.status : undefined,
        message: typeof p.message === 'string' ? p.message : undefined,
      });
    }),
  );

  return () => offs.forEach((off) => off());
}

export async function requestPreviewOpen(
  transport: TransportHandle,
  sessionId: string,
  url: string | null,
  opts: RequestOpts = {},
): Promise<void> {
  const { timeoutMs, setTimer, clearTimer } = getTimers(opts, PREVIEW_OPEN_TIMEOUT_MS);
  usePreview.getState().beginOpen(url);
  const startedAt = usePreview.getState().lastUpdatedAt;
  const timer = setTimer(() => {
    const s = usePreview.getState();
    if (s.status === 'starting' && s.lastUpdatedAt === startedAt) {
      s.setUnsupported(PREVIEW_TIMEOUT_REASON);
    }
  }, timeoutMs);

  try {
    const payload = url ? { session_id: sessionId, url } : { session_id: sessionId };
    await sendPreviewEvent(transport, sessionId, 'workspace.preview.open', payload);
  } catch (err) {
    clearTimer(timer);
    usePreview.getState().setError(err instanceof Error ? err.message : String(err));
  }
}

export async function requestPreviewRefresh(
  transport: TransportHandle,
  sessionId: string,
  opts: RequestOpts = {},
): Promise<void> {
  const { timeoutMs, setTimer, clearTimer } = getTimers(opts, PREVIEW_REFRESH_TIMEOUT_MS);
  usePreview.getState().setUpdated({ status: 'starting' });
  const startedAt = usePreview.getState().lastUpdatedAt;
  const timer = setTimer(() => {
    const s = usePreview.getState();
    if (s.status === 'starting' && s.lastUpdatedAt === startedAt) {
      s.setUnsupported(PREVIEW_TIMEOUT_REASON);
    }
  }, timeoutMs);

  try {
    await sendPreviewEvent(transport, sessionId, 'workspace.preview.refresh', { session_id: sessionId });
  } catch (err) {
    clearTimer(timer);
    usePreview.getState().setError(err instanceof Error ? err.message : String(err));
  }
}

export async function requestPreviewStop(
  transport: TransportHandle,
  sessionId: string,
): Promise<void> {
  try {
    await sendPreviewEvent(transport, sessionId, 'workspace.preview.stop', { session_id: sessionId });
    usePreview.getState().setStopped();
  } catch (err) {
    usePreview.getState().setError(err instanceof Error ? err.message : String(err));
  }
}

export async function requestPreviewSendContext(
  transport: TransportHandle,
  sessionId: string,
  context: Omit<PreviewContextPayload, 'session_id'>,
): Promise<void> {
  const payload: PreviewContextPayload = { ...context, session_id: sessionId };
  await sendPreviewEvent(transport, sessionId, 'workspace.preview.send_context', payload);
}

export async function requestPreviewRunE2e(
  transport: TransportHandle,
  sessionId: string,
  url: string | null,
): Promise<void> {
  const payload = url ? { session_id: sessionId, url } : { session_id: sessionId };
  await sendPreviewEvent(transport, sessionId, 'workspace.preview.run_e2e', payload);
}
