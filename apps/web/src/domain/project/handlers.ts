// Wire project.tree.* and project.file.* events -> useProject store,
// plus outbound request helpers with a 'no bridge support' timeout
// fallback.
//
// Phase 2: the bridge is not yet expected to support these events. The
// handlers stay subscribed so that when the bridge ships, no frontend
// change is needed. Until then, requestProjectTree / requestProjectFile
// time out and flip the slot to 'unsupported', which the UI renders as
// the truthful 'Unavailable: bridge does not support project file
// browsing yet.' copy.

import { useProject, type ProjectEntry } from '../../stores/project';
import type { TransportHandle } from '../../transport';

interface TreeUpdatedPayload {
  session_id?: string;
  entries?: unknown;
}

interface TreeUnsupportedPayload {
  session_id?: string;
  reason?: string;
}

interface TreeErrorPayload {
  session_id?: string;
  message?: string;
}

interface FileLoadedPayload {
  session_id?: string;
  path?: string;
  content?: string;
  encoding?: string;
  size?: number;
  truncated?: boolean;
}

interface FileUnsupportedPayload {
  session_id?: string;
  path?: string;
  reason?: string;
}

interface FileErrorPayload {
  session_id?: string;
  path?: string;
  message?: string;
}

function isEntry(raw: unknown): raw is ProjectEntry {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== 'string' || r.path.length === 0) return false;
  if (r.type !== 'file' && r.type !== 'directory') return false;
  return true;
}

function normalizeEntries(raw: unknown): ProjectEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectEntry[] = [];
  for (const item of raw) {
    if (isEntry(item)) {
      const entry: ProjectEntry = { path: item.path, type: item.type };
      const maybeSize = (item as { size?: unknown }).size;
      if (typeof maybeSize === 'number') {
        entry.size = maybeSize;
      }
      out.push(entry);
    }
  }
  return out;
}

export const PROJECT_TREE_TIMEOUT_MS = 4000;
export const PROJECT_FILE_TIMEOUT_MS = 6000;

export function registerProjectHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('project.tree.updated', (ev) => {
      const p = (ev.payload ?? {}) as TreeUpdatedPayload;
      useProject.getState().setTreeLoaded(normalizeEntries(p.entries));
    }),
  );

  offs.push(
    transport.on('project.tree.unsupported', (ev) => {
      const p = (ev.payload ?? {}) as TreeUnsupportedPayload;
      useProject.getState().setTreeUnsupported(p.reason ?? null);
    }),
  );

  offs.push(
    transport.on('project.tree.error', (ev) => {
      const p = (ev.payload ?? {}) as TreeErrorPayload;
      useProject.getState().setTreeError(p.message ?? 'unknown error');
    }),
  );

  offs.push(
    transport.on('project.file.loaded', (ev) => {
      const p = (ev.payload ?? {}) as FileLoadedPayload;
      if (typeof p.path !== 'string' || p.path.length === 0) return;
      useProject.getState().setFileLoaded({
        path: p.path,
        content: typeof p.content === 'string' ? p.content : undefined,
        encoding: typeof p.encoding === 'string' ? p.encoding : undefined,
        size: typeof p.size === 'number' ? p.size : undefined,
        truncated: typeof p.truncated === 'boolean' ? p.truncated : undefined,
      });
    }),
  );

  offs.push(
    transport.on('project.file.unsupported', (ev) => {
      const p = (ev.payload ?? {}) as FileUnsupportedPayload;
      if (typeof p.path !== 'string' || p.path.length === 0) return;
      useProject.getState().setFileUnsupported(p.path, p.reason ?? null);
    }),
  );

  offs.push(
    transport.on('project.file.error', (ev) => {
      const p = (ev.payload ?? {}) as FileErrorPayload;
      if (typeof p.path !== 'string' || p.path.length === 0) return;
      useProject.getState().setFileError(p.path, p.message ?? 'unknown error');
    }),
  );

  return () => offs.forEach((off) => off());
}

interface RequestOpts {
  timeoutMs?: number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export async function requestProjectTree(
  transport: TransportHandle,
  sessionId: string,
  opts: RequestOpts = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? PROJECT_TREE_TIMEOUT_MS;
  const setTimer =
    opts.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer =
    opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  useProject.getState().beginTreeRequest();
  const startedAt = useProject.getState().treeRequestedAt;
  const timer = setTimer(() => {
    const s = useProject.getState();
    if (s.treeStatus === 'requesting' && s.treeRequestedAt === startedAt) {
      s.setTreeUnsupported('no response from bridge within timeout');
    }
  }, timeoutMs);

  try {
    await transport.send(sessionId, 'project.tree.request', {});
  } catch (err) {
    clearTimer(timer);
    useProject
      .getState()
      .setTreeError(err instanceof Error ? err.message : String(err));
  }
}

export async function requestProjectFile(
  transport: TransportHandle,
  sessionId: string,
  path: string,
  opts: RequestOpts = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? PROJECT_FILE_TIMEOUT_MS;
  const setTimer =
    opts.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer =
    opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  useProject.getState().beginFileRequest(path);
  const timer = setTimer(() => {
    const f = useProject.getState().files[path];
    if (f && f.status === 'requesting') {
      useProject
        .getState()
        .setFileUnsupported(path, 'no response from bridge within timeout');
    }
  }, timeoutMs);

  try {
    await transport.send(sessionId, 'project.file.request', { path });
  } catch (err) {
    clearTimer(timer);
    useProject
      .getState()
      .setFileError(path, err instanceof Error ? err.message : String(err));
  }
}
