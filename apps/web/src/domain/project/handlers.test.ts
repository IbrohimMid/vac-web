import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectHandlers, requestProjectFile, requestProjectTree } from './handlers';
import { useProject } from '../../stores/project';
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

describe('project handlers', () => {
  beforeEach(() => {
    useProject.getState().resetAll();
  });

  it('project.tree.updated stores entries, dropping malformed items', () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    t.emit('project.tree.updated', {
      entries: [
        { path: 'src/a.ts', type: 'file', size: 12 },
        { path: 'src', type: 'directory' },
        { path: '', type: 'file' },
        { path: 'no-type' },
        'not-an-object',
      ],
    });
    const s = useProject.getState();
    expect(s.treeStatus).toBe('loaded');
    expect(s.entries).toEqual([
      { path: 'src/a.ts', type: 'file', size: 12 },
      { path: 'src', type: 'directory' },
    ]);
  });

  it('project.tree.unsupported marks unsupported with reason', () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    t.emit('project.tree.unsupported', { reason: 'no bridge support' });
    expect(useProject.getState().treeStatus).toBe('unsupported');
    expect(useProject.getState().treeError).toBe('no bridge support');
  });

  it('project.tree.error marks error with message', () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    t.emit('project.tree.error', { message: 'permission denied' });
    expect(useProject.getState().treeStatus).toBe('error');
    expect(useProject.getState().treeError).toBe('permission denied');
  });

  it('project.file.loaded stores content and marks loaded', () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    t.emit('project.file.loaded', {
      path: 'src/a.ts',
      content: 'x',
      encoding: 'utf-8',
      size: 1,
      truncated: false,
    });
    const f = useProject.getState().files['src/a.ts']!;
    expect(f.status).toBe('loaded');
    expect(f.content).toBe('x');
  });

  it('project.file.unsupported and project.file.error update the file slot', () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    t.emit('project.file.unsupported', { path: 'src/a.ts', reason: 'no' });
    expect(useProject.getState().files['src/a.ts']!.status).toBe('unsupported');
    t.emit('project.file.error', { path: 'src/b.ts', message: 'bad' });
    const f = useProject.getState().files['src/b.ts']!;
    expect(f.status).toBe('error');
    expect(f.errorMessage).toBe('bad');
  });

  it('requestProjectTree timeout flips to unsupported when no event arrives', async () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    let scheduled: (() => void) | null = null;
    await requestProjectTree(t as unknown as TransportHandle, 'sess-1', {
      timeoutMs: 1000,
      setTimer: (cb) => {
        scheduled = cb;
        return 1;
      },
      clearTimer: () => {},
    });
    expect(t.send).toHaveBeenCalledWith('sess-1', 'project.tree.request', {});
    expect(useProject.getState().treeStatus).toBe('requesting');
    scheduled!();
    const s = useProject.getState();
    expect(s.treeStatus).toBe('unsupported');
    expect(s.treeError).toBe('no response from bridge within timeout');
  });

  it('requestProjectTree response before timeout keeps loaded state', async () => {
    const t = createMockTransport();
    registerProjectHandlers(t as unknown as TransportHandle);
    let scheduled: (() => void) | null = null;
    await requestProjectTree(t as unknown as TransportHandle, 'sess-1', {
      timeoutMs: 1000,
      setTimer: (cb) => {
        scheduled = cb;
        return 1;
      },
      clearTimer: () => {},
    });
    t.emit('project.tree.updated', { entries: [{ path: 'a.ts', type: 'file' }] });
    expect(useProject.getState().treeStatus).toBe('loaded');
    scheduled!();
    expect(useProject.getState().treeStatus).toBe('loaded');
  });

  it('requestProjectFile send rejection marks file error', async () => {
    const t = createMockTransport();
    t.send.mockRejectedValueOnce(new Error('disconnected'));
    registerProjectHandlers(t as unknown as TransportHandle);
    await requestProjectFile(t as unknown as TransportHandle, 'sess-1', 'src/a.ts', {
      timeoutMs: 1000,
      setTimer: () => 1,
      clearTimer: () => {},
    });
    const f = useProject.getState().files['src/a.ts']!;
    expect(f.status).toBe('error');
    expect(f.errorMessage).toBe('disconnected');
  });
});
