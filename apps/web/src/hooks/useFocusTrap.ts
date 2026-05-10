import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

interface FocusTrapOptions {
  onEscape?: (() => void) | undefined;
  restoreFocus?: boolean | undefined;
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
) {
  const { onEscape, restoreFocus = true } = options;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const capturedFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    if (!capturedFocusRef.current) {
      previousFocusRef.current = getActiveElement();
      capturedFocusRef.current = true;
    }

    if (!container.contains(document.activeElement)) {
      focusInitialElement(container);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!onEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }

      if (event.key !== 'Tab') return;
      event.stopPropagation();

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        focusElement(container);
        return;
      }

      const current = getActiveElement();
      const index = current ? focusables.indexOf(current) : -1;

      if (index === -1) {
        event.preventDefault();
        const nextTarget = event.shiftKey
          ? focusables[focusables.length - 1]
          : focusables[0];
        if (nextTarget) focusElement(nextTarget);
        return;
      }

      if (event.shiftKey && index === 0) {
        event.preventDefault();
        const previousTarget = focusables[focusables.length - 1];
        if (previousTarget) focusElement(previousTarget);
        return;
      }

      if (!event.shiftKey && index === focusables.length - 1) {
        event.preventDefault();
        const nextTarget = focusables[0];
        if (nextTarget) focusElement(nextTarget);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof HTMLElement && container.contains(next)) {
        event.stopPropagation();
        return;
      }

      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

      event.stopPropagation();

      const focusables = getFocusableElements(container);
      const first = focusables[0];
      if (first) {
        focusElement(first);
        return;
      }

      focusElement(container);
    };

    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('focusout', handleFocusOut);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('focusout', handleFocusOut);
    };
  }, [active, containerRef, onEscape]);

  useEffect(() => {
    return () => {
      if (!restoreFocus) return;
      restoreFocusTo(previousFocusRef.current);
    };
  }, [restoreFocus]);
}

function getActiveElement(): HTMLElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  if (el === document.body || el === document.documentElement) return null;
  return el;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.hidden && !isInsideHiddenSubtree(container, el),
  );
}

function isInsideHiddenSubtree(container: HTMLElement, element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    if (current.hidden) return true;
    if (current.getAttribute('aria-hidden') === 'true') return true;
    if (current.hasAttribute('inert')) return true;
    current = current.parentElement;
  }
  return current !== container;
}

function focusInitialElement(container: HTMLElement) {
  const focusables = getFocusableElements(container);
  const autofocus =
    focusables.find((el) =>
      el.hasAttribute('autofocus') || el.getAttribute('data-autofocus') === 'true',
    ) ?? null;
  if (autofocus) {
    focusElement(autofocus);
    return;
  }

  const first = focusables[0];
  if (first) {
    focusElement(first);
    return;
  }

  if (!container.hasAttribute('tabindex')) {
    container.tabIndex = -1;
  }
  focusElement(container);
}

function focusElement(element: HTMLElement) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function restoreFocusTo(element: HTMLElement | null) {
  if (!element || !element.isConnected) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}
