// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExtensions } from '../../../stores/extensions';
import type { TransportHandle } from '../../../transport';
import { ExtensionsList } from './ExtensionsList';

function stubTransport(): TransportHandle {
  return {
    send: vi.fn().mockResolvedValue({ ok: true }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as TransportHandle;
}

describe('ExtensionsList', () => {
  beforeEach(() => {
    useExtensions.getState().clear();
  });
  afterEach(() => {
    cleanup();
    useExtensions.getState().clear();
  });

  it('renders empty state when no entries', () => {
    render(<ExtensionsList transport={null} />);
    expect(screen.getByTestId('extensions-empty')).toBeInTheDocument();
  });

  it('renders a row per extension with the persisted tier selected', () => {
    useExtensions.getState().setSnapshot({
      version: 1,
      allow_unsigned: false,
      publishers: ['pubA'],
      entries: [
        {
          id: 'ext-bundled',
          tier: 'allowed_bundled',
          source: 'bundled',
          publisher: null,
          decision: 'allowed_bundled',
        },
        {
          id: 'ext-quar',
          tier: 'quarantined',
          source: 'signed',
          publisher: 'pubA',
          decision: 'quarantined',
        },
      ],
    });
    render(<ExtensionsList transport={null} />);
    expect(
      screen.getByTestId('extension-row-ext-bundled'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('extension-row-ext-quar'),
    ).toBeInTheDocument();
    const select = screen.getByLabelText(
      'Trust tier for ext-quar',
    ) as HTMLSelectElement;
    expect(select.value).toBe('quarantined');
  });

  it('routes revoked -> allowed_* through the promotion request modal', () => {
    const transport = stubTransport();
    useExtensions.getState().setSnapshot({
      version: 1,
      allow_unsigned: false,
      publishers: [],
      entries: [
        {
          id: 'ext-revoked',
          tier: 'revoked',
          source: 'signed',
          publisher: null,
          decision: 'revoked',
        },
      ],
    });
    render(<ExtensionsList transport={transport} />);
    const select = screen.getByLabelText(
      'Trust tier for ext-revoked',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'allowed_signed' } });
    expect(
      screen.getByTestId('promotion-request-modal'),
    ).toBeInTheDocument();
    expect(transport.send).not.toHaveBeenCalledWith(
      expect.anything(),
      'extensions.update_trust',
      expect.anything(),
    );
  });

  it('routes quarantine -> revoked through the demotion confirm modal', () => {
    const transport = stubTransport();
    useExtensions.getState().setSnapshot({
      version: 1,
      allow_unsigned: false,
      publishers: [],
      entries: [
        {
          id: 'ext-quar',
          tier: 'quarantined',
          source: 'signed',
          publisher: null,
          decision: 'quarantined',
        },
      ],
    });
    render(<ExtensionsList transport={transport} />);
    const select = screen.getByLabelText(
      'Trust tier for ext-quar',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'revoked' } });
    expect(
      screen.getByTestId('quarantine-confirm'),
    ).toBeInTheDocument();
  });
});
