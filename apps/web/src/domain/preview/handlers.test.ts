import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerPreviewHandlers,
  requestPreviewOpen,
  requestPreviewRefresh,
  requestPreviewRunE2e,
  requestPreviewSendContext,
  requestPreviewStop,
} from './handlers';
import { usePreview } from '../../stores/preview';
import type { TransportHandle } from '../../transport';

interface EventFrameLite {
  id: string;
  seq: number;
  ts: string;
  type: string;
  payload?: unknown;
}

interface MockTransport {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(type: string, payload: unknown): void;
}

function createMockTransport(): MockTransport {
  const handlers = new Map<string, Array<(ev: EventFrameLite) => void>>();
  const transport: MockTransport = {
    send: vi.fn().mockResolvedValue({} as never),
    close: vi.fn(),
    on: vi.fn().mockImplementation((type: string, h: (ev: EventFrameLite) => void) => {
      const list = handlers.get(type) ?? [];
      list.push(h);
      handlers.set(type, list);
      return () => {
        const cur = handlers.get(type) ?? [];
        handlers.set(type, cur.filter((x) => x !== h));
      };
    }),
    emit(type, payload) {
      const ev: EventFrameLite = { id: 'e', seq: 1, ts: '2026-05-14T00:00:00Z', type, payload };
      (handlers.get(type) ?? []).forEach((h) => h(ev));
    },
  };
  return transport;
}

describe('preview handlers', () => {
  beforeEach(() => {
    usePreview.getState().resetAll();
  });

  it('workspace.preview.updated stores status and URL', () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    t.emit('workspace.preview.updated', { status: 'running', url: 'http://localhost:4181' });
    const s = usePreview.getState();
    expect(s.status).toBe('running');
    expect(s.url).toBe('http://localhost:4181');
  });

  it('workspace.preview.updated ignores unknown status', () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    t.emit('workspace.preview.updated', { status: 'booted', url: 'http://localhost:4181' });
    expect(usePreview.getState().status).toBe('idle');
  });

  it('unsupported and error events update truthful state', () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    t.emit('workspace.preview.unsupported', { reason: 'bridge missing' });
    expect(usePreview.getState().status).toBe('unsupported');
    expect(usePreview.getState().unsupportedReason).toBe('bridge missing');
    t.emit('workspace.preview.error', { message: 'crashed' });
    expect(usePreview.getState().status).toBe('failed');
    expect(usePreview.getState().errorMessage).toBe('crashed');
  });

  it('diagnostic events append console and network summaries', () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    t.emit('workspace.preview.console_error', { message: 'ReferenceError', source: 'main.js', line: 10 });
    t.emit('workspace.preview.network_failure', { url: 'http://localhost/api', status: 500, message: 'bad' });
    expect(usePreview.getState().consoleErrors[0]!.message).toBe('ReferenceError');
    expect(usePreview.getState().networkFailures[0]!.status).toBe(500);
  });

  it('diagnostic events ignore malformed payloads', () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    t.emit('workspace.preview.console_error', { source: 'main.js' });
    t.emit('workspace.preview.network_failure', { message: 'bad' });
    expect(usePreview.getState().consoleErrors).toHaveLength(0);
    expect(usePreview.getState().networkFailures).toHaveLength(0);
  });

  it('cleanup unsubscribes handlers', () => {
    const t = createMockTransport();
    const off = registerPreviewHandlers(t as unknown as TransportHandle);
    off();
    t.emit('workspace.preview.updated', { status: 'running', url: 'http://localhost:4181' });
    expect(usePreview.getState().status).toBe('idle');
  });

  it('requestPreviewOpen sends URL payload and times out to unsupported', async () => {
    const t = createMockTransport();
    let scheduled: (() => void) | null = null;
    await requestPreviewOpen(t as unknown as TransportHandle, 'sess-1', 'http://localhost:4181', {
      timeoutMs: 1,
      setTimer: (cb) => {
        scheduled = cb;
        return 1;
      },
      clearTimer: () => {},
    });
    expect(t.send).toHaveBeenCalledWith('sess-1', 'workspace.preview.open', {
      session_id: 'sess-1',
      url: 'http://localhost:4181',
    });
    expect(usePreview.getState().status).toBe('starting');
    scheduled!();
    expect(usePreview.getState().status).toBe('unsupported');
    expect(usePreview.getState().unsupportedReason).toBe('no response from bridge within timeout');
  });

  it('requestPreviewOpen sends payload without URL when absent', async () => {
    const t = createMockTransport();
    await requestPreviewOpen(t as unknown as TransportHandle, 'sess-1', null, {
      setTimer: () => 1,
      clearTimer: () => {},
    });
    expect(t.send).toHaveBeenCalledWith('sess-1', 'workspace.preview.open', { session_id: 'sess-1' });
  });

  it('requestPreviewOpen response before timeout keeps running state', async () => {
    const t = createMockTransport();
    registerPreviewHandlers(t as unknown as TransportHandle);
    let scheduled: (() => void) | null = null;
    await requestPreviewOpen(t as unknown as TransportHandle, 'sess-1', 'http://localhost:4181', {
      setTimer: (cb) => {
        scheduled = cb;
        return 1;
      },
      clearTimer: () => {},
    });
    t.emit('workspace.preview.updated', { status: 'running', url: 'http://localhost:4181' });
    scheduled!();
    expect(usePreview.getState().status).toBe('running');
  });

  it('requestPreviewRefresh sends refresh and has timeout fallback', async () => {
    const t = createMockTransport();
    let scheduled: (() => void) | null = null;
    await requestPreviewRefresh(t as unknown as TransportHandle, 'sess-1', {
      setTimer: (cb) => {
        scheduled = cb;
        return 1;
      },
      clearTimer: () => {},
    });
    expect(t.send).toHaveBeenCalledWith('sess-1', 'workspace.preview.refresh', { session_id: 'sess-1' });
    scheduled!();
    expect(usePreview.getState().status).toBe('unsupported');
  });

  it('send rejection marks failed for open and refresh', async () => {
    const t = createMockTransport();
    t.send.mockRejectedValueOnce(new Error('disconnected'));
    await requestPreviewOpen(t as unknown as TransportHandle, 'sess-1', 'http://localhost:4181', {
      setTimer: () => 1,
      clearTimer: () => {},
    });
    expect(usePreview.getState().status).toBe('failed');
    expect(usePreview.getState().errorMessage).toBe('disconnected');

    usePreview.getState().resetAll();
    t.send.mockRejectedValueOnce(new Error('refresh disconnected'));
    await requestPreviewRefresh(t as unknown as TransportHandle, 'sess-1', {
      setTimer: () => 1,
      clearTimer: () => {},
    });
    expect(usePreview.getState().errorMessage).toBe('refresh disconnected');
  });

  it('requestPreviewStop sends stop and marks stopped', async () => {
    const t = createMockTransport();
    await requestPreviewStop(t as unknown as TransportHandle, 'sess-1');
    expect(t.send).toHaveBeenCalledWith('sess-1', 'workspace.preview.stop', { session_id: 'sess-1' });
    expect(usePreview.getState().status).toBe('stopped');
  });

  it('requestPreviewSendContext sends explicit context payload', async () => {
    const t = createMockTransport();
    await requestPreviewSendContext(t as unknown as TransportHandle, 'sess-1', {
      url: 'http://localhost:4181',
      console_errors: [],
      network_failures: [],
      viewport: { width: 1280, height: 720 },
    });
    expect(t.send).toHaveBeenCalledWith('sess-1', 'workspace.preview.send_context', {
      session_id: 'sess-1',
      url: 'http://localhost:4181',
      console_errors: [],
      network_failures: [],
      viewport: { width: 1280, height: 720 },
    });
  });

  it('requestPreviewRunE2e sends optional URL payload', async () => {
    const t = createMockTransport();
    await requestPreviewRunE2e(t as unknown as TransportHandle, 'sess-1', 'http://localhost:4181');
    await requestPreviewRunE2e(t as unknown as TransportHandle, 'sess-1', null);
    expect(t.send).toHaveBeenNthCalledWith(1, 'sess-1', 'workspace.preview.run_e2e', {
      session_id: 'sess-1',
      url: 'http://localhost:4181',
    });
    expect(t.send).toHaveBeenNthCalledWith(2, 'sess-1', 'workspace.preview.run_e2e', { session_id: 'sess-1' });
  });
});
