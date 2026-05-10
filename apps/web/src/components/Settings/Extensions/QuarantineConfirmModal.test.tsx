// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuarantineConfirmModal } from './QuarantineConfirmModal';

const SAMPLE_ENTRY = {
  id: 'ext-foo',
  tier: 'allowed_bundled' as const,
  source: 'bundled' as const,
  publisher: null,
  decision: 'allowed_bundled' as const,
};

describe('QuarantineConfirmModal', () => {
  afterEach(cleanup);

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuarantineConfirmModal
        entry={SAMPLE_ENTRY}
        targetTier="quarantined"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('quarantine-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuarantineConfirmModal
        entry={SAMPLE_ENTRY}
        targetTier="revoked"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('quarantine-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('focuses the confirm action and closes on Escape', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuarantineConfirmModal
        entry={SAMPLE_ENTRY}
        targetTier="quarantined"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId('quarantine-confirm')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('quarantine-confirm'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
