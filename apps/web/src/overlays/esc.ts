import { useOverlays } from '../stores/overlays';

/**
 * Attach global Esc → dismiss topmost overlay.
 * Returns cleanup fn.
 */
export function attachEscHandler(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (useOverlays.getState().dismissTopmost()) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
