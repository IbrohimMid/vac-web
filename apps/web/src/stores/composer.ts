import { create } from 'zustand';

interface ComposerSlice {
  text: string;
  submitting: boolean;
  setText(t: string): void;
  setSubmitting(v: boolean): void;
  reset(): void;
}

export const useComposer = create<ComposerSlice>((set) => ({
  text: '',
  submitting: false,
  setText(t) {
    set({ text: t });
  },
  setSubmitting(v) {
    set({ submitting: v });
  },
  reset() {
    set({ text: '', submitting: false });
  },
}));
