// Project tree + file state for the Code Workspace (Phase 2).
//
// Owns the frontend-side state machine for project browsing. The bridge
// contract is one-way request/response over the existing transport:
//   Outbound:  project.tree.request    { session_id, root? }
//              project.file.request    { session_id, path }
//   Inbound:   project.tree.updated    { session_id, entries }
//              project.tree.unsupported{ session_id, reason? }
//              project.tree.error      { session_id, message }
//              project.file.loaded     { session_id, path, content, encoding?, size?, truncated? }
//              project.file.unsupported{ session_id, path, reason? }
//              project.file.error      { session_id, path, message }
//
// Phase 2 ships the frontend half only. If no bridge response arrives
// within the request timeout (see domain/project/handlers.ts), the tree
// status falls back to 'unsupported' so the UI shows the truthful copy
// 'Unavailable: bridge does not support project file browsing yet.'.

import { create } from 'zustand';

export type ProjectTreeStatus =
  | 'idle'
  | 'requesting'
  | 'loaded'
  | 'empty'
  | 'error'
  | 'unsupported';

export interface ProjectEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export type ProjectFileStatus =
  | 'idle'
  | 'requesting'
  | 'loaded'
  | 'error'
  | 'unsupported';

export interface ProjectFile {
  path: string;
  status: ProjectFileStatus;
  content?: string | undefined;
  encoding?: string | undefined;
  size?: number | undefined;
  truncated?: boolean | undefined;
  errorMessage?: string | undefined;
  loadedAt?: string | undefined;
}

interface ProjectSlice {
  treeStatus: ProjectTreeStatus;
  entries: ProjectEntry[];
  treeError: string | null;
  treeRequestedAt: string | null;
  files: Record<string, ProjectFile>;
  beginTreeRequest(): void;
  setTreeLoaded(entries: ProjectEntry[]): void;
  setTreeUnsupported(reason?: string | null): void;
  setTreeError(message: string): void;
  beginFileRequest(path: string): void;
  setFileLoaded(file: Omit<ProjectFile, 'status' | 'loadedAt'>): void;
  setFileUnsupported(path: string, reason?: string | null): void;
  setFileError(path: string, message: string): void;
  resetAll(): void;
}

export const useProject = create<ProjectSlice>((set) => ({
  treeStatus: 'idle',
  entries: [],
  treeError: null,
  treeRequestedAt: null,
  files: {},
  beginTreeRequest() {
    set({
      treeStatus: 'requesting',
      treeError: null,
      treeRequestedAt: new Date().toISOString(),
    });
  },
  setTreeLoaded(entries) {
    set({
      treeStatus: entries.length === 0 ? 'empty' : 'loaded',
      entries: entries.slice(),
      treeError: null,
    });
  },
  setTreeUnsupported(reason) {
    set({
      treeStatus: 'unsupported',
      treeError: reason ?? null,
    });
  },
  setTreeError(message) {
    set({
      treeStatus: 'error',
      treeError: message,
    });
  },
  beginFileRequest(path) {
    set((s) => ({
      files: {
        ...s.files,
        [path]: {
          ...(s.files[path] ?? { path }),
          path,
          status: 'requesting',
          errorMessage: undefined,
        },
      },
    }));
  },
  setFileLoaded(file) {
    set((s) => ({
      files: {
        ...s.files,
        [file.path]: {
          ...file,
          status: 'loaded',
          loadedAt: new Date().toISOString(),
        },
      },
    }));
  },
  setFileUnsupported(path, reason) {
    set((s) => ({
      files: {
        ...s.files,
        [path]: {
          ...(s.files[path] ?? { path }),
          path,
          status: 'unsupported',
          errorMessage: reason ?? undefined,
        },
      },
    }));
  },
  setFileError(path, message) {
    set((s) => ({
      files: {
        ...s.files,
        [path]: {
          ...(s.files[path] ?? { path }),
          path,
          status: 'error',
          errorMessage: message,
        },
      },
    }));
  },
  resetAll() {
    set({
      treeStatus: 'idle',
      entries: [],
      treeError: null,
      treeRequestedAt: null,
      files: {},
    });
  },
}));
