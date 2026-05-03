// Transcript store with hot/cold freeze support.

import { create } from 'zustand';

export type Role = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** e.g. "vil_codegen.handler" */
  name: string;
  /** Display string for args (already-formatted by emitter). */
  args: string;
  status: 'ok' | 'pending' | 'error';
  /** Optional expandable body — stdout/stderr/diff, plain text. */
  output?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  state: 'streaming' | 'completed' | 'error';
  createdAt: string;
  error?: string;
  /** Sanitized HTML; set when message is frozen. */
  renderedHTML?: string;
  /** True once moved out of hot window. */
  isCold: boolean;
  /** Inline tool call attached to this message (Stage H). */
  toolCall?: ToolCall;
}

export const HOT_WINDOW_SIZE = 50;

/**
 * Slice 50: rendering pipeline mode for the transcript surface.
 * - `live`   : streaming new messages.
 * - `replay` : closed session being replayed.
 * - `frozen` : read-only (e.g. archived session).
 *
 * The `transcriptFreeze` capability owns the catalog of pipeline
 * modes (`PIPELINE_MODES`); this store field selects the active one.
 */
export type TranscriptRenderMode = 'live' | 'replay' | 'frozen';

interface TranscriptSlice {
  messages: Map<string, Message>;
  order: string[];
  hotWindowIds: Set<string>;
  /** Slice 50: active rendering pipeline mode. Defaults to `'live'`. */
  mode: TranscriptRenderMode;
  upsert(m: Omit<Message, 'isCold'>): void;
  appendDelta(id: string, delta: string): void;
  complete(id: string): void;
  error(id: string, msg: string): void;
  freeze(id: string, html: string): void;
  unfreeze(id: string): void;
  setMode(mode: TranscriptRenderMode): void;
  clear(): void;
}

export const useTranscript = create<TranscriptSlice>((set) => ({
  messages: new Map(),
  order: [],
  hotWindowIds: new Set(),
  mode: 'live',
  setMode(mode) {
    set({ mode });
  },

  upsert(m) {
    set((s) => {
      const messages = new Map(s.messages);
      const order = s.order.includes(m.id) ? s.order : [...s.order, m.id];
      const hotWindowIds = new Set(s.hotWindowIds);
      if (!hotWindowIds.has(m.id)) hotWindowIds.add(m.id);
      messages.set(m.id, { ...m, isCold: false });
      return { messages, order, hotWindowIds };
    });
  },

  appendDelta(id, delta) {
    set((s) => {
      const msg = s.messages.get(id);
      if (!msg || msg.isCold) return s;
      const messages = new Map(s.messages);
      messages.set(id, {
        ...msg,
        content: msg.content + delta,
        state: 'streaming',
      });
      return { messages };
    });
  },

  complete(id) {
    set((s) => {
      const msg = s.messages.get(id);
      if (!msg) return s;
      const messages = new Map(s.messages);
      messages.set(id, { ...msg, state: 'completed' });
      return { messages };
    });
  },

  error(id, errMsg) {
    set((s) => {
      const msg = s.messages.get(id);
      if (!msg) return s;
      const messages = new Map(s.messages);
      messages.set(id, { ...msg, state: 'error', error: errMsg });
      return { messages };
    });
  },

  freeze(id, html) {
    set((s) => {
      const msg = s.messages.get(id);
      if (!msg || msg.state !== 'completed') return s;
      const messages = new Map(s.messages);
      messages.set(id, { ...msg, renderedHTML: html, isCold: true });
      const hotWindowIds = new Set(s.hotWindowIds);
      hotWindowIds.delete(id);
      return { messages, hotWindowIds };
    });
  },

  unfreeze(id) {
    set((s) => {
      const msg = s.messages.get(id);
      if (!msg) return s;
      const messages = new Map(s.messages);
      messages.set(id, { ...msg, isCold: false });
      const hotWindowIds = new Set(s.hotWindowIds);
      hotWindowIds.add(id);
      return { messages, hotWindowIds };
    });
  },

  clear() {
    set({ messages: new Map(), order: [], hotWindowIds: new Set() });
  },
}));
