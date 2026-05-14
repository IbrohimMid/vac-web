// Preview store: app preview URL, status, console / network failure
// summaries.
//
// Phase 4: state machine for the in-workspace preview panel. The bridge
// is not yet expected to support `workspace.preview.*` events. While
// the bridge is silent, the store stays in 'idle' (or moves to
// 'unsupported' once a request times out) and the UI renders truthful
// copy.
//
// Outbound (frontend -> bridge):
//   workspace.preview.open { session_id, url? }
//   workspace.preview.refresh { session_id }
//   workspace.preview.stop { session_id }
//   workspace.preview.send_context { session_id, url, console_errors?, network_failures?, viewport?, screenshot_data_url? }
//   workspace.preview.run_e2e { session_id, url? }
//
// Inbound (bridge -> frontend):
//   workspace.preview.updated { session_id, status, url? }
//   workspace.preview.unsupported { session_id, reason? }
//   workspace.preview.error { session_id, message }
//   workspace.preview.console_error { session_id, message, source?, line? }
//   workspace.preview.network_failure { session_id, url, status?, message? }

import { create } from 'zustand';

export type PreviewStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'failed'
  | 'stopped'
  | 'unsupported';

export interface PreviewConsoleError {
  message: string;
  source?: string | undefined;
  line?: number | undefined;
  receivedAt: number;
}

export interface PreviewNetworkFailure {
  url: string;
  status?: number | undefined;
  message?: string | undefined;
  receivedAt: number;
}

export interface PreviewSlice {
  status: PreviewStatus;
  url: string | null;
  errorMessage: string | null;
  unsupportedReason: string | null;
  lastUpdatedAt: number | null;
  consoleErrors: PreviewConsoleError[];
  networkFailures: PreviewNetworkFailure[];

  beginOpen(url: string | null): void;
  setUpdated(args: { status: PreviewStatus; url?: string | null | undefined }): void;
  setUnsupported(reason: string | null): void;
  setError(message: string): void;
  setStopped(): void;
  appendConsoleError(entry: { message: string; source?: string | undefined; line?: number | undefined }): void;
  appendNetworkFailure(entry: { url: string; status?: number | undefined; message?: string | undefined }): void;
  clearConsole(): void;
  resetAll(): void;
}

export const PREVIEW_CONSOLE_CAP = 25;
export const PREVIEW_NETWORK_CAP = 25;

export const usePreview = create<PreviewSlice>((set) => ({
  status: 'idle',
  url: null,
  errorMessage: null,
  unsupportedReason: null,
  lastUpdatedAt: null,
  consoleErrors: [],
  networkFailures: [],

  beginOpen(url) {
    set({
      status: 'starting',
      url: url ?? null,
      errorMessage: null,
      unsupportedReason: null,
      lastUpdatedAt: Date.now(),
    });
  },

  setUpdated({ status, url }) {
    set((s) => ({
      status,
      url: url === undefined ? s.url : url,
      errorMessage: status === 'failed' ? s.errorMessage : null,
      unsupportedReason: status === 'unsupported' ? s.unsupportedReason : null,
      lastUpdatedAt: Date.now(),
    }));
  },

  setUnsupported(reason) {
    set({
      status: 'unsupported',
      unsupportedReason: reason,
      errorMessage: null,
      lastUpdatedAt: Date.now(),
    });
  },

  setError(message) {
    set({
      status: 'failed',
      errorMessage: message,
      lastUpdatedAt: Date.now(),
    });
  },

  setStopped() {
    set((s) => ({
      status: 'stopped',
      url: s.url,
      lastUpdatedAt: Date.now(),
    }));
  },

  appendConsoleError(entry) {
    set((s) => {
      const next: PreviewConsoleError[] = [
        ...s.consoleErrors,
        {
          message: entry.message,
          source: entry.source,
          line: entry.line,
          receivedAt: Date.now(),
        },
      ];
      return { consoleErrors: next.slice(-PREVIEW_CONSOLE_CAP) };
    });
  },

  appendNetworkFailure(entry) {
    set((s) => {
      const next: PreviewNetworkFailure[] = [
        ...s.networkFailures,
        {
          url: entry.url,
          status: entry.status,
          message: entry.message,
          receivedAt: Date.now(),
        },
      ];
      return { networkFailures: next.slice(-PREVIEW_NETWORK_CAP) };
    });
  },

  clearConsole() {
    set({ consoleErrors: [], networkFailures: [] });
  },

  resetAll() {
    set({
      status: 'idle',
      url: null,
      errorMessage: null,
      unsupportedReason: null,
      lastUpdatedAt: null,
      consoleErrors: [],
      networkFailures: [],
    });
  },
}));

// Allow-list URL guard. Phase 4 only accepts loopback URLs (localhost,
// 127.0.0.1, [::1]) to avoid embedding arbitrary cross-origin content
// in the in-workspace iframe without explicit operator consent.
export function isAllowedPreviewUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (host === '127.0.0.1') return true;
  if (host === '[::1]' || host === '::1') return true;
  return false;
}
