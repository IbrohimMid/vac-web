// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CodeOnboarding } from './CodeOnboarding';
import type { TransportHandle } from '../../transport';

const transport = {
  send: vi.fn().mockResolvedValue({} as never),
  on: vi.fn().mockReturnValue(() => {}),
  close: vi.fn(),
} as unknown as TransportHandle;

describe('<CodeOnboarding/>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders first-run checklist when bridge/session are missing', () => {
    render(<CodeOnboarding sessionId={null} transport={null} onOpenBuild={vi.fn()} onOpenRuntime={vi.fn()} onSelectTab={vi.fn()} />);
    expect(screen.getByTestId('code-onboarding')).toHaveTextContent('Start coding in three safe steps');
    expect(screen.getByText('Pair local bridge or relay first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix bug/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Review changes/i })).not.toBeDisabled();
  });

  it('enables starter actions and dispatches tab selection when ready', () => {
    const onSelectTab = vi.fn();
    render(<CodeOnboarding sessionId="sess1" transport={transport} onOpenBuild={vi.fn()} onOpenRuntime={vi.fn()} onSelectTab={onSelectTab} />);
    expect(screen.getByTestId('code-onboarding')).toHaveTextContent('Ready to code in this session');
    fireEvent.click(screen.getByRole('button', { name: /Run validation/i }));
    expect(onSelectTab).toHaveBeenCalledWith('validation');
    fireEvent.click(screen.getByRole('button', { name: /Preview UI/i }));
    expect(onSelectTab).toHaveBeenCalledWith('preview');
  });

  it('routes to Build and runtime recovery surfaces', () => {
    const onOpenBuild = vi.fn();
    const onOpenRuntime = vi.fn();
    render(<CodeOnboarding sessionId="sess1" transport={transport} onOpenBuild={onOpenBuild} onOpenRuntime={onOpenRuntime} onSelectTab={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open Build surface/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open runtime drawer/i }));
    expect(onOpenBuild).toHaveBeenCalledTimes(1);
    expect(onOpenRuntime).toHaveBeenCalledTimes(1);
  });
});
