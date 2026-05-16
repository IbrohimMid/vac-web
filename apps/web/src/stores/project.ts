// Project tree + file state for the Code Workspace (Phases 2-3).
//
// Phase 2 added the tree/file state machine.
// Phase 3 (UI maturity) adds:
//   - tree options (maxDepth, pathPrefix, includeHidden) forwarded to
//     project.tree.request as max_depth / path_prefix / include_hidden
//   - tree meta (truncated, entryCount, capReason) parsed from
//     project.tree.updated for the "Tree truncated" banner
//   - per-directory expand state for the hierarchy view
//   - a client-side filter string for the Explorer search input

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

export interface ProjectTreeOptions {
  maxDepth?: number;
  pathPrefix?: string;
  includeHidden?: boolean;
}

export interface ProjectTreeMeta {
  truncated?: boolean;
  entryCount?: number;
  capReason?: string | null;
}

interface ProjectSlice {
  treeStatus: ProjectTreeStatus;
  entries: ProjectEntry[];
  treeError: string | null;
  treeRequestedAt: string | null;
  truncated: boolean;
  entryCount: number | null;
  capReason: string | null;
  files: Record<string, ProjectFile>;
  selectedFilePath: string | null;
  selectedLines: ProjectSelection | null;
  expanded: Record<string, boolean>;
  filter: string;
  treeOptions: ProjectTreeOptions;
  beginTreeRequest(): void;
  setTreeLoaded(entries: ProjectEntry[], meta?: ProjectTreeMeta): void;
  setTreeUnsupported(reason?: string | null): void;
  setTreeError(message: string): void;
  beginFileRequest(path: string): void;
  setFileLoaded(file: Omit<ProjectFile, 'status' | 'loadedAt'>): void;
  setFileUnsupported(path: string, reason?: string | null): void;
  setFileError(path: string, message: string): void;
  selectPath(path: string | null): void;
  selectLines(range: ProjectSelection | null): void;
  clearSelection(): void;
  setExpanded(path: string, value: boolean): void;
  toggleExpanded(path: string): void;
  setFilter(value: string): void;
  setTreeOptions(opts: Partial<ProjectTreeOptions>): void;
  resetAll(): void;
}

export const useProject = create<ProjectSlice>((set) => ({
  treeStatus: 'idle',
  entries: [],
  treeError: null,
  treeRequestedAt: null,
  truncated: false,
  entryCount: null,
  capReason: null,
  files: {},
  selectedFilePath: null,
  selectedLines: null,
  expanded: {},
  filter: '',
  treeOptions: {},
  beginTreeRequest() {
    set({
      treeStatus: 'requesting',
      treeError: null,
      treeRequestedAt: new Date().toISOString(),
    });
  },
  setTreeLoaded(entries, meta) {
    set({
      treeStatus: entries.length === 0 ? 'empty' : 'loaded',
      entries: entries.slice(),
      treeError: null,
      truncated: meta?.truncated === true,
      entryCount:
        typeof meta?.entryCount === 'number' ? meta.entryCount : entries.length,
      capReason: typeof meta?.capReason === 'string' ? meta.capReason : null,
    });
  },
  setTreeUnsupported(reason) {
    set({ treeStatus: 'unsupported', treeError: reason ?? null });
  },
  setTreeError(message) {
    set({ treeStatus: 'error', treeError: message });
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
  setExpanded(path, value) {
    set((s) => ({ expanded: { ...s.expanded, [path]: value } }));
  },
  toggleExpanded(path) {
    set((s) => ({
      expanded: { ...s.expanded, [path]: !(s.expanded[path] ?? false) },
    }));
  },
  setFilter(value) {
    set({ filter: value });
  },
  setTreeOptions(opts) {
    set((s) => ({ treeOptions: { ...s.treeOptions, ...opts } }));
  },
  resetAll() {
    set({
      treeStatus: 'idle',
      entries: [],
      treeError: null,
      treeRequestedAt: null,
      truncated: false,
      entryCount: null,
      capReason: null,
      files: {},
      selectedFilePath: null,
      selectedLines: null,
      expanded: {},
      filter: '',
      treeOptions: {},
    });
  },
}));
