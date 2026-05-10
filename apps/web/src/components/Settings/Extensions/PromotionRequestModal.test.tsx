// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromotionRequestModal } from './PromotionRequestModal';

const REVOKED_ENTRY = {
  id: 'ext-foo',
  tier: 'revoked' as const,
  source: 'signed' as const,
  publisher: null,
  decision: 'revoked' as const,
};

describe('PromotionRequestModal', () => {
  afterEach(cleanup);

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromotionRequestModal
        entry={REVOKED_ENTRY}
        targetTier="allowed_signed"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('promotion-request-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromotionRequestModal
        entry={REVOKED_ENTRY}
        targetTier="allowed_bundled"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('promotion-request-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('describes the requested tier change in the dialog body', () => {
    render(
      <PromotionRequestModal
        entry={REVOKED_ENTRY}
        targetTier="allowed_signed"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('alertdialog', { name: /Request promotion/i }),
    ).toBeInTheDocument();
  });

  it('focuses the confirm action and closes on Escape', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromotionRequestModal
        entry={REVOKED_ENTRY}
        targetTier="allowed_signed"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId('promotion-request-confirm')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('promotion-request-confirm'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
