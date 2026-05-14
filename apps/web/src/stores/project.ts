// Project tree + file state for the Code Workspace (Phases 2-3).
//
// Phase 2 added the tree/file state machine.
// Phase 3 adds selection state (selectedFilePath + selectedLines) so the
// Code Workspace center pane can render a CodePanel and dispatch
// file-level agent actions (see domain/coding/context.ts).

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

export interface ProjectSelection {
  start: number;
  end: number;
}

interface ProjectSlice {
  treeStatus: ProjectTreeStatus;
  entries: ProjectEntry[];
  treeError: string | null;
  treeRequestedAt: string | null;
  files: Record<string, ProjectFile>;
  selectedFilePath: string | null;
  selectedLines: ProjectSelection | null;
  beginTreeRequest(): void;
  setTreeLoaded(entries: ProjectEntry[]): void;
  setTreeUnsupported(reason?: string | null): void;
  setTreeError(message: string): void;
  beginFileRequest(path: string): void;
  setFileLoaded(file: Omit<ProjectFile, 'status' | 'loadedAt'>): void;
  setFileUnsupported(path: string, reason?: string | null): void;
  setFileError(path: string, message: string): void;
  selectPath(path: string | null): void;
  selectLines(range: ProjectSelection | null): void;
  clearSelection(): void;
  resetAll(): void;
}

export const useProject = create<ProjectSlice>((set) => ({
  treeStatus: 'idle',
  entries: [],
  treeError: null,
  treeRequestedAt: null,
  files: {},
  selectedFilePath: null,
  selectedLines: null,
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
  selectPath(path) {
    set({ selectedFilePath: path, selectedLines: null });
  },
  selectLines(range) {
    set({ selectedLines: range });
  },
  clearSelection() {
    set({ selectedFilePath: null, selectedLines: null });
  },
  resetAll() {
    set({
      treeStatus: 'idle',
      entries: [],
      treeError: null,
      treeRequestedAt: null,
      files: {},
      selectedFilePath: null,
      selectedLines: null,
    });
  },
}));
