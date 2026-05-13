// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PairingRelay, maskPairingUrl } from './PairingRelay';

describe('PairingRelay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ opaque: 'secret-token-123456', short_code: '12345678' }),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('masks token-bearing pairing URLs in visible copy', () => {
    const masked = maskPairingUrl('https://example.test/?relay=ws://r&token=secret-token-123456&device=d');
    expect(masked).toContain('token=%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A23456');
    expect(masked).not.toContain('secret-token-');
  });

  it('labels the browser surface as copy-only instead of a QR preview', async () => {
    render(<PairingRelay relayUrl="ws://relay.test" deviceId="dev1" sessionId="sess1" />);
    await waitFor(() => expect(screen.getByLabelText('Masked pairing URL')).toBeInTheDocument());
    expect(screen.getByText(/QR rendering is not available/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/QR/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Masked pairing URL').textContent ?? '').not.toContain('secret-token-');
  });
});
