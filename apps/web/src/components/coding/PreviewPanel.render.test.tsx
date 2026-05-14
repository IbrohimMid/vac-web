// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PreviewPanel } from './PreviewPanel';
import { usePreview } from '../../stores/preview';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return {
    send: vi.fn().mockResolvedValue({} as never),
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as TransportHandle;
}

describe('<PreviewPanel/>', () => {
  beforeEach(() => {
    usePreview.getState().resetAll();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty state when there is no active session', () => {
    render(<PreviewPanel sessionId={null} transport={null} />);
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument();
    expect(screen.getByText(/Connect a session/i)).toBeInTheDocument();
  });

  it('renders idle form with truthful unsupported copy', () => {
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-idle')).toBeInTheDocument();
    expect(screen.getByTestId('preview-open-form')).toBeInTheDocument();
    expect(screen.getByText(/preview bridge support is not confirmed/i)).toBeInTheDocument();
  });

  it('submitting a valid loopback URL emits workspace.preview.open', () => {
    const t = fakeTransport();
    render(<PreviewPanel sessionId="s1" transport={t} />);
    fireEvent.change(screen.getByLabelText(/Preview URL/i), { target: { value: 'http://localhost:4181' } });
    fireEvent.submit(screen.getByTestId('preview-open-form'));
    expect(t.send).toHaveBeenCalledWith('s1', 'workspace.preview.open', {
      session_id: 's1',
      url: 'http://localhost:4181',
    });
  });

  it('rejects a non-loopback URL in the open form', () => {
    const t = fakeTransport();
    render(<PreviewPanel sessionId="s1" transport={t} />);
    fireEvent.change(screen.getByLabelText(/Preview URL/i), { target: { value: 'https://example.com' } });
    fireEvent.submit(screen.getByTestId('preview-open-form'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Only loopback URLs/i);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('renders starting state', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-starting')).toBeInTheDocument();
    expect(screen.getByText(/Opening preview/i)).toBeInTheDocument();
  });

  it('renders sandboxed iframe when running with allowed URL', () => {
    usePreview.getState().setUpdated({ status: 'running', url: 'http://127.0.0.1:4181' });
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    const frame = screen.getByTestId('preview-frame');
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:4181');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('blocks running iframe for non-loopback URL', () => {
    usePreview.getState().setUpdated({ status: 'running', url: 'https://example.com' });
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-url-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-frame')).not.toBeInTheDocument();
  });

  it('renders failed state and retry form', () => {
    usePreview.getState().setError('bridge crashed');
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-failed')).toBeInTheDocument();
    expect(screen.getByText('bridge crashed')).toBeInTheDocument();
  });

  it('renders stopped state', () => {
    usePreview.getState().beginOpen('http://localhost:4181');
    usePreview.getState().setStopped();
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-stopped')).toBeInTheDocument();
    expect(screen.getByText(/Preview stopped/i)).toBeInTheDocument();
  });

  it('renders unsupported state with reason', () => {
    usePreview.getState().setUnsupported('no response from bridge within timeout');
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/bridge does not support browser preview yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no response from bridge within timeout/i)).toBeInTheDocument();
  });

  it('toolbar sends refresh, context, e2e, stop, copy, and clear actions', async () => {
    const t = fakeTransport();
    usePreview.getState().setUpdated({ status: 'running', url: 'http://localhost:4181' });
    usePreview.getState().appendConsoleError({ message: 'err' });
    usePreview.getState().appendNetworkFailure({ url: 'http://localhost/api' });
    render(<PreviewPanel sessionId="s1" transport={t} />);

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send context/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run e2e/i }));
    fireEvent.click(screen.getByRole('button', { name: /Stop/i }));
    fireEvent.click(screen.getByRole('button', { name: /Copy URL/i }));
    fireEvent.click(screen.getByRole('button', { name: /Clear console/i }));

    expect(t.send).toHaveBeenCalledWith('s1', 'workspace.preview.refresh', { session_id: 's1' });
    expect(t.send).toHaveBeenCalledWith('s1', 'workspace.preview.send_context', expect.objectContaining({
      session_id: 's1',
      url: 'http://localhost:4181',
    }));
    expect(t.send).toHaveBeenCalledWith('s1', 'workspace.preview.run_e2e', {
      session_id: 's1',
      url: 'http://localhost:4181',
    });
    expect(t.send).toHaveBeenCalledWith('s1', 'workspace.preview.stop', { session_id: 's1' });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:4181');
    expect(usePreview.getState().consoleErrors).toHaveLength(0);
    expect(usePreview.getState().networkFailures).toHaveLength(0);
  });

  it('renders console summary counts', () => {
    usePreview.getState().appendConsoleError({ message: 'err' });
    usePreview.getState().appendNetworkFailure({ url: 'http://localhost/api' });
    render(<PreviewPanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('preview-console-summary')).toHaveTextContent('Console errors: 1');
    expect(screen.getByTestId('preview-console-summary')).toHaveTextContent('Network failures: 1');
  });
});
