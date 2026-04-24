// Overlay stack — max depth 2, Esc precedence (innermost first).
//
// `originFocus` captures the activeElement at open-time so OverlayHost can
// restore focus on dismiss. We use an element reference, not a selector, so
// re-render cycles that invalidate ids don't break focus restore.

import { create } from 'zustand';

export type OverlayKind =
  | 'command_palette'
  | 'file_search'
  | 'approval_inspector'
  | 'diff_viewer'
  | 'handoff_builder'
  | 'gate_detail'
  | 'assessment_report'
  | 'connector_manager'
  | 'confirm'
  | 'ask_user'
  | 'guided_mode';

export interface Overlay {
  id: string;
  kind: OverlayKind;
  params: Record<string, unknown>;
  originFocus: WeakRef<HTMLElement> | null;
}

interface OverlaysSlice {
  stack: Overlay[];
  open(kind: OverlayKind, params?: Record<string, unknown>): string;
  dismiss(id: string): void;
  dismissTopmost(): boolean;
  dismissAll(): void;
  isOpen(kind: OverlayKind): boolean;
  topmost(): Overlay | null;
}

const MAX_DEPTH = 2;

function newId(): string {
  return 'ovl_' + Math.random().toString(36).slice(2, 10);
}

function captureOriginFocus(): WeakRef<HTMLElement> | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  return typeof WeakRef !== 'undefined' ? new WeakRef(el) : null;
}

function restoreFocus(ref: WeakRef<HTMLElement> | null) {
  if (!ref) return;
  const el = ref.deref();
  if (el && el.isConnected && typeof el.focus === 'function') {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
  }
}

export const useOverlays = create<OverlaysSlice>((set, get) => ({
  stack: [],

  open(kind, params = {}) {
    const id = newId();
    const overlay: Overlay = {
      id,
      kind,
      params,
      originFocus: captureOriginFocus(),
    };
    set((s) => {
      let stack = [...s.stack, overlay];
      while (stack.length > MAX_DEPTH) {
        // Evict bottom; restore focus of the displaced overlay.
        const evicted = stack[0];
        if (evicted) restoreFocus(evicted.originFocus);
        stack = stack.slice(1);
      }
      return { stack };
    });
    return id;
  },

  dismiss(id) {
    set((s) => {
      const target = s.stack.find((o) => o.id === id);
      if (target) restoreFocus(target.originFocus);
      return { stack: s.stack.filter((o) => o.id !== id) };
    });
  },

  dismissTopmost() {
    const s = get();
    if (s.stack.length === 0) return false;
    const top = s.stack[s.stack.length - 1];
    if (top) restoreFocus(top.originFocus);
    set({ stack: s.stack.slice(0, -1) });
    return true;
  },

  dismissAll() {
    const s = get();
    for (const overlay of s.stack) restoreFocus(overlay.originFocus);
    set({ stack: [] });
  },

  isOpen(kind) {
    return get().stack.some((o) => o.kind === kind);
  },

  topmost() {
    const s = get();
    return s.stack.length > 0 ? (s.stack[s.stack.length - 1] ?? null) : null;
  },
}));
