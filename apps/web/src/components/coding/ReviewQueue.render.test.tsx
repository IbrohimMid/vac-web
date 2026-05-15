// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReviewQueue } from './ReviewQueue';
import { useCockpit } from '../../stores/cockpit';
import { useReview } from '../../stores/review';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

function fakeTransport(): TransportHandle {
  return { send: vi.fn().mockResolvedValue({} as never), on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

function seedReview() {
  useSession.getState().setSession('s1', 'mock', '/tmp/repo');
  useReview.getState().setFiles([
    { path: 'src/auth/token.ts', status: 'modified', additions: 2, deletions: 1, toolCallId: 'tc1', sourceEventType: 'review.changeset_updated' },
  ]);
  useReview.getState().setDiff({ path: 'src/auth/token.ts', truncated: false, unified: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new' });
}

describe('<ReviewQueue/>', () => {
  beforeEach(() => {
    useReview.getState().clear();
    useSession.getState().clear();
    useCockpit.setState({ route: 'code' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty state', () => {
    render(<ReviewQueue transport={null} />);
    expect(screen.getByTestId('review-queue-empty')).toBeInTheDocument();
  });

  it('renders file with risk label and hunk summary', () => {
    seedReview();
    render(<ReviewQueue transport={fakeTransport()} />);
    expect(screen.getByTestId('review-queue')).toBeInTheDocument();
    expect(screen.getByText('src/auth/token.ts')).toBeInTheDocument();
    expect(screen.getByText('security-sensitive')).toBeInTheDocument();
    expect(screen.getByText('hunk-1')).toBeInTheDocument();
  });

  it('renders unloaded hunk state when diff body is absent', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    useReview.getState().setFiles([{ path: 'docs/readme.md', status: 'modified', additions: 1, deletions: 0 }]);
    render(<ReviewQueue transport={fakeTransport()} />);
    expect(screen.getByTestId('review-queue-hunks-empty')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('dispatches file and hunk review actions', () => {
    seedReview();
    const t = fakeTransport();
    render(<ReviewQueue transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Request file revert/i }));
    fireEvent.click(screen.getByRole('button', { name: /Ask agent to revise/i }));
    fireEvent.click(screen.getByRole('button', { name: /Request hunk revert/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'review.revert_file', { session_id: 's1', path: 'src/auth/token.ts' });
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', expect.objectContaining({ action: 'request_rework', path: 'src/auth/token.ts' }));
    expect(t.send).toHaveBeenCalledWith('s1', 'review.hunk.action.request', expect.objectContaining({ action: 'revert_hunk', path: 'src/auth/token.ts' }));
    expect(screen.getByText(/Sending file revert request/i)).toBeInTheDocument();
  });

  it('disables hunk actions without transport/session', () => {
    seedReview();
    useSession.getState().clear();
    render(<ReviewQueue transport={null} />);
    expect(screen.getByRole('button', { name: /Request file revert/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ask agent to revise/i })).toBeDisabled();
  });

  it('open full review routes to Build surface', () => {
    seedReview();
    render(<ReviewQueue transport={fakeTransport()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open full Review/i }));
    expect(useCockpit.getState().route).toBe('build');
  });
});
