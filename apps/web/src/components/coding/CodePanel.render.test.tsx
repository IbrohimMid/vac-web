// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CodePanel } from './CodePanel';
import { useProject } from '../../stores/project';
import { useReview } from '../../stores/review';
import { useCockpit } from '../../stores/cockpit';
import type { TransportHandle } from '../../transport';

function fakeTransport(send = vi.fn().mockResolvedValue({} as never)) {
  return {
    send,
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as TransportHandle & { send: ReturnType<typeof vi.fn> };
}

describe('<CodePanel/>', () => {
  beforeEach(() => {
    useProject.getState().resetAll();
    useReview.getState().clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty hint when no file selected', () => {
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-empty')).toBeInTheDocument();
  });

  it('renders loading state when file is requesting', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().beginFileRequest('src/a.ts');
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-loading')).toBeInTheDocument();
  });

  it('renders source body with line numbers when loaded', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'alpha\nbeta\ngamma',
      encoding: 'utf-8',
      size: 16,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-source')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('selects a single line on click and a range on shift-click', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'a\nb\nc\nd\ne',
      encoding: 'utf-8',
      size: 9,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    const line2 = screen.getByText('b').parentElement!;
    fireEvent.click(line2);
    expect(useProject.getState().selectedLines).toEqual({ start: 2, end: 2 });
    const line4 = screen.getByText('d').parentElement!;
    fireEvent.click(line4, { shiftKey: true });
    expect(useProject.getState().selectedLines).toEqual({ start: 2, end: 4 });
  });

  it('shows truthful unsupported copy when file status is unsupported', () => {
    useProject.getState().selectPath('src/x.ts');
    useProject.getState().setFileUnsupported('src/x.ts', 'bridge missing');
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/bridge does not support project file browsing yet/i)).toBeInTheDocument();
  });

  it('shows error state with retry when file status is error', () => {
    useProject.getState().selectPath('src/x.ts');
    useProject.getState().setFileError('src/x.ts', 'EACCES');
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-error')).toBeInTheDocument();
    expect(screen.getByText('EACCES')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows pending diff badge when path is in review files', () => {
    useReview.getState().setFiles([{ path: 'src/a.ts', status: 'modified', additions: 4, deletions: 2 }]);
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'one',
      encoding: 'utf-8',
      size: 3,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-diff-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open related diff' })).not.toBeDisabled();
  });

  it('ask about file dispatches coding.context.ask_about_file and routes to build', async () => {
    useCockpit.setState({ route: 'code' });
    const send = vi.fn().mockResolvedValue({} as never);
    const t = fakeTransport(send);
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'hello',
      encoding: 'utf-8',
      size: 5,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={t} />);
    fireEvent.click(screen.getByTestId('code-panel-ask-file'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledWith('s1', 'coding.context.ask_about_file', expect.objectContaining({ session_id: 's1', path: 'src/a.ts' }));
    expect(useCockpit.getState().route).toBe('build');
  });

  it('ask about selection only enabled when selection exists', () => {
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'a\nb',
      encoding: 'utf-8',
      size: 3,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    expect(screen.getByTestId('code-panel-ask-selection')).toBeDisabled();
    fireEvent.click(screen.getByText('b').parentElement!);
    expect(screen.getByTestId('code-panel-ask-selection')).not.toBeDisabled();
  });

  it('copy path writes to clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    useProject.getState().selectPath('src/a.ts');
    useProject.getState().setFileLoaded({
      path: 'src/a.ts',
      content: 'x',
      encoding: 'utf-8',
      size: 1,
      truncated: false,
    });
    render(<CodePanel sessionId="s1" transport={fakeTransport()} />);
    fireEvent.click(screen.getByTestId('code-panel-copy-path'));
    expect(writeText).toHaveBeenCalledWith('src/a.ts');
  });
});
