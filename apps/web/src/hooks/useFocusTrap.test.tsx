// @vitest-environment happy-dom

import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useFocusTrap } from './useFocusTrap';

function TrapHarness({
  active = true,
  onEscape,
  autofocusSecond = false,
}: {
  active?: boolean | undefined;
  onEscape?: (() => void) | undefined;
  autofocusSecond?: boolean | undefined;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(active, ref, { onEscape });
  return (
    <div ref={ref}>
      <button data-testid="first">First</button>
      <button data-testid="second" data-autofocus={autofocusSecond ? 'true' : undefined}>
        Second
      </button>
    </div>
  );
}

function Shell({
  open,
  onEscape,
}: {
  open: boolean;
  onEscape?: (() => void) | undefined;
}) {
  return (
    <div>
      <button data-testid="outside">Outside</button>
      {open ? <TrapHarness onEscape={onEscape} /> : null}
    </div>
  );
}

function NestedTrap({
  outerEscape,
  innerEscape,
}: {
  outerEscape?: (() => void) | undefined;
  innerEscape?: (() => void) | undefined;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, outerRef, { onEscape: outerEscape });
  return (
    <div ref={outerRef}>
      <button data-testid="outer-first">Outer First</button>
      <NestedInner onEscape={innerEscape} />
    </div>
  );
}

function NestedInner({ onEscape }: { onEscape?: (() => void) | undefined }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, innerRef, { onEscape });
  return (
    <div ref={innerRef}>
      <button data-testid="inner-first">Inner First</button>
      <button data-testid="inner-second">Inner Second</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(cleanup);

  it('focuses an autofocus control before defaulting to the first tabbable', () => {
    render(<TrapHarness autofocusSecond />);

    expect(screen.getByTestId('second')).toHaveFocus();
  });

  it('cycles Tab and Shift+Tab inside the trap', () => {
    render(<TrapHarness />);

    const first = screen.getByTestId('first');
    const second = screen.getByTestId('second');

    second.focus();
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(second).toHaveFocus();
  });

  it('calls onEscape and restores the prior focus on unmount', () => {
    const onEscape = vi.fn();
    const { rerender } = render(<Shell open={false} />);
    const outside = screen.getByTestId('outside');
    outside.focus();

    rerender(<Shell open={true} onEscape={onEscape} />);
    expect(screen.getByTestId('first')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('first'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);

    rerender(<Shell open={false} />);
    expect(outside).toHaveFocus();
  });

  it('lets the innermost trap consume Escape before the outer trap sees it', () => {
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();
    render(<NestedTrap outerEscape={outerEscape} innerEscape={innerEscape} />);

    fireEvent.keyDown(screen.getByTestId('inner-second'), { key: 'Escape' });

    expect(innerEscape).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();
  });
});
