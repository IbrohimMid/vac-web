import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { attachEscHandler } from '../../overlays/esc';
import type { OverlayRegistry } from '../../overlays/registry';
import { useOverlays } from '../../stores/overlays';

/**
 * Single root that renders the overlay stack into a portal.
 * OverlayHost owns:
 *   - backdrop + z-index stacking
 *   - Esc precedence (innermost first)
 *   - body scroll lock when stack non-empty
 *   - focus restore (via stores/overlays originFocus)
 *
 * Overlay content is provided via `registry` — map of OverlayKind → component.
 * Each overlay kind's component receives `{id, params, dismiss}`.
 */
export function OverlayHost({ registry }: { registry: OverlayRegistry }) {
  const stack = useOverlays((s) => s.stack);
  const dismiss = useOverlays((s) => s.dismiss);

  useEffect(() => attachEscHandler(), []);

  useEffect(() => {
    if (stack.length > 0) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [stack.length]);

  if (stack.length === 0) return null;

  return createPortal(
    <>
      {stack.map((overlay, idx) => {
        const Component = registry[overlay.kind];
        if (!Component) return null;
        const isTop = idx === stack.length - 1;
        return (
          <div
            key={overlay.id}
            role="dialog"
            aria-modal="true"
            aria-hidden={!isTop}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100 + idx,
              background: 'rgba(0,0,0,0.3)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              paddingTop: '10vh',
            }}
            onClick={(e) => {
              if (e.currentTarget === e.target) dismiss(overlay.id);
            }}
          >
            <Component
              id={overlay.id}
              params={overlay.params}
              dismiss={() => dismiss(overlay.id)}
            />
          </div>
        );
      })}
    </>,
    document.body,
  );
}
