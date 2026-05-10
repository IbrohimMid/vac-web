import { useCallback, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import type { OverlayRegistry, OverlayRenderProps } from '../../overlays/registry';
import { useOverlays } from '../../stores/overlays';
import { useFocusTrap } from '../../hooks/useFocusTrap';

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
        return (
          <OverlayFrame
            key={overlay.id}
            overlayId={overlay.id}
            overlayIndex={idx}
            isTop={idx === stack.length - 1}
            Component={Component}
            params={overlay.params}
            dismissOverlay={dismiss}
          />
        );
      })}
    </>,
    document.body,
  );
}

function OverlayFrame({
  overlayId,
  overlayIndex,
  isTop,
  Component,
  params,
  dismissOverlay,
}: {
  overlayId: string;
  overlayIndex: number;
  isTop: boolean;
  Component: ComponentType<OverlayRenderProps> | undefined;
  params: Record<string, unknown>;
  dismissOverlay: (id: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const handleDismiss = useCallback(() => dismissOverlay(overlayId), [dismissOverlay, overlayId]);
  useFocusTrap(isTop, frameRef, { onEscape: handleDismiss });

  if (!Component) return null;

  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isTop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100 + overlayIndex,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '10vh',
      }}
      onClick={(e) => {
        if (e.currentTarget === e.target) handleDismiss();
      }}
    >
      <Component id={overlayId} params={params} dismiss={handleDismiss} />
    </div>
  );
}
