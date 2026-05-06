// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useExtensions } from '../../../stores/extensions';
import { ExtensionsList } from './ExtensionsList';

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
});
