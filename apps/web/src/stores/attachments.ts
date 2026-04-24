// Composer attachments: paths/URLs/pasted code blocks the user has attached
// for the next message. Bridge reads these off when `message.submit` fires.

import { create } from 'zustand';

export interface Attachment {
  id: string;
  kind: 'file' | 'url' | 'code';
  label: string;
  payload: string;
}

interface AttachmentsSlice {
  items: Attachment[];
  add(a: Attachment): void;
  remove(id: string): void;
  clear(): void;
}

export const useAttachments = create<AttachmentsSlice>((set) => ({
  items: [],
  add(a) {
    set((s) => ({ items: [...s.items.filter((i) => i.id !== a.id), a] }));
  },
  remove(id) {
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
  clear() {
    set({ items: [] });
  },
}));
