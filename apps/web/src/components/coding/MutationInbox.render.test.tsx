// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MutationInbox, useMutationInboxPendingCount } from './MutationInbox';
import { useMutations, type MutationIntent } from '../../stores/mutations';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

function fakeTransport(send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({} as never)): TransportHandle {
  return { send, on: vi.fn().mockReturnValue(() => {}), close: vi.fn() } as unknown as TransportHandle;
}

function seedIntent(overrides: Partial<MutationIntent> = {}): MutationIntent {
  const intent: MutationIntent = {
    requestId: 'req-1',
    kind: 'write',
    summary: 'Create src/foo.ts',
    rationale: 'Adds new feature',
    targetPath: 'src/foo.ts',
    diffPreview: '+ hello',
    originatingTaskId: 'task-1',
    originatingSessionId: 'sess-1',
    receivedAt: 1,
    status: 'pending',
    sourceEventType: 'bridge.mutation.requested',
    ...overrides,
  };
  useMutations.getState().upsert(intent);
  return intent;
}

describe('<MutationInbox/>', () => {
  beforeEach(() => {
    useMutations.setState({ intents: {}, order: [] });
    useSession.getState().clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the empty state when no intents exist', () => {
    render(<MutationInbox transport={null} />);
    expect(screen.getByTestId('mutation-inbox-empty')).toBeInTheDocument();
    expect(screen.getByText(/Browser never writes directly/i)).toBeInTheDocument();
  });

  it('renders an intent card with kind label, target, rationale, diff and audit', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    render(<MutationInbox transport={fakeTransport()} />);
    expect(screen.getByTestId('mutation-inbox')).toBeInTheDocument();
    expect(screen.getByText('Write file')).toBeInTheDocument();
    expect(screen.getByText('Create src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('Adds new feature')).toBeInTheDocument();
    expect(screen.getByTestId('mutation-inbox-diff')).toHaveTextContent('+ hello');
    expect(screen.getByText('task-1')).toBeInTheDocument();
  });

  it('renders structured hunks when diffPreview contains @@ markers', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({
      diffPreview: '@@ -1,2 +1,2 @@\n-old\n+new\n ctx',
    });
    render(<MutationInbox transport={fakeTransport()} />);
    const hunks = screen.getAllByTestId('mutation-inbox-hunk');
    expect(hunks).toHaveLength(1);
    expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeInTheDocument();
    expect(screen.getByText('+1 / -1')).toBeInTheDocument();
  });

  it('hunk revert button dispatches bridge.mutation.refine_request with deterministic note', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({
      summary: 'Refactor token store',
      diffPreview: '@@ -1 +1 @@\n-a\n+b\n@@ -10 +10 @@\n-c\n+d',
    });
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    const revertButtons = screen.getAllByTestId('mutation-inbox-hunk-revert');
    expect(revertButtons).toHaveLength(2);
    fireEvent.click(revertButtons[1]!);
    expect(t.send).toHaveBeenCalledWith(
      's1',
      'bridge.mutation.refine_request',
      expect.objectContaining({
        session_id: 's1',
        request_id: 'req-1',
        note: expect.stringContaining('hunk-2'),
      }),
    );
    const noteArg = (t.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(String(noteArg.note)).toContain('@@ -10 +10 @@');
    expect(String(noteArg.note)).toContain('Refactor token store');
  });

  it('hunk revert button is disabled once the intent is not pending', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({ status: 'applied', diffPreview: '@@ -1 +1 @@\n-a\n+b' });
    render(<MutationInbox transport={fakeTransport()} />);
    expect(screen.getByTestId('mutation-inbox-hunk-revert')).toBeDisabled();
  });

  it('approve click dispatches bridge.mutation.approve and writes optimistic status', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve & apply/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', expect.objectContaining({ session_id: 's1', request_id: 'req-1' }));
    expect(useMutations.getState().intents['req-1']?.status).toBe('approved');
  });

  it('reject click dispatches bridge.mutation.reject', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.reject', expect.objectContaining({ session_id: 's1', request_id: 'req-1' }));
    expect(useMutations.getState().intents['req-1']?.status).toBe('rejected');
  });

  it('refine click prompts the user and dispatches bridge.mutation.refine_request', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    const t = fakeTransport();
    render(<MutationInbox transport={t} promptForRefine={() => 'use a hashmap'} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask local AI to refine/i }));
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.refine_request', expect.objectContaining({ session_id: 's1', request_id: 'req-1', note: 'use a hashmap' }));
    expect(useMutations.getState().intents['req-1']?.status).toBe('pending');
  });

  it('refine is a no-op when the prompt returns null', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    const t = fakeTransport();
    render(<MutationInbox transport={t} promptForRefine={() => null} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask local AI to refine/i }));
    expect(t.send).not.toHaveBeenCalled();
  });

  it('keyboard A approves the focused card', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent();
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    const card = screen.getByTestId('mutation-inbox-card');
    card.focus();
    fireEvent.keyDown(card, { key: 'A' });
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', expect.any(Object));
  });

  it('actions are disabled when transport or session is missing', () => {
    seedIntent();
    render(<MutationInbox transport={null} />);
    expect(screen.getByRole('button', { name: /Approve & apply/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeDisabled();
  });

  it('shows the applying spinner when the bridge transitions to applying', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({ status: 'applying', statusMessage: 'Writing 3 hunks' });
    render(<MutationInbox transport={fakeTransport()} />);
    expect(screen.getByTestId('mutation-inbox-applying')).toBeInTheDocument();
  });

  it('failed intents expose a Retry approval button that re-sends approve', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({ status: 'failed', statusMessage: 'Bridge apply failed: EACCES' });
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    fireEvent.click(screen.getByTestId('mutation-inbox-retry'));
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', expect.objectContaining({ request_id: 'req-1' }));
    expect(useMutations.getState().intents['req-1']?.status).toBe('approved');
  });

  it('keyboard R on a failed card triggers retry, not reject', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({ status: 'failed' });
    const t = fakeTransport();
    render(<MutationInbox transport={t} />);
    const card = screen.getByTestId('mutation-inbox-card');
    card.focus();
    fireEvent.keyDown(card, { key: 'R' });
    expect(t.send).toHaveBeenCalledWith('s1', 'bridge.mutation.approve', expect.any(Object));
  });

  it('actions are disabled once the intent is no longer pending', () => {
    useSession.getState().setSession('s1', 'mock', '/tmp/repo');
    seedIntent({ status: 'applied' });
    render(<MutationInbox transport={fakeTransport()} />);
    expect(screen.getByRole('button', { name: /Approve & apply/i })).toBeDisabled();
  });
});

describe('useMutationInboxPendingCount', () => {
  beforeEach(() => useMutations.setState({ intents: {}, order: [] }));

  it('counts only pending intents', () => {
    useMutations.getState().upsert({ requestId: 'a', kind: 'write', summary: 'A', receivedAt: 1, status: 'pending', sourceEventType: 'bridge.mutation.requested' });
    useMutations.getState().upsert({ requestId: 'b', kind: 'edit', summary: 'B', receivedAt: 2, status: 'applied', sourceEventType: 'bridge.mutation.requested' });
    useMutations.getState().upsert({ requestId: 'c', kind: 'edit', summary: 'C', receivedAt: 3, status: 'pending', sourceEventType: 'bridge.mutation.requested' });
    function Probe() { const n = useMutationInboxPendingCount(); return <span data-testid="probe">{n}</span>; }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('2');
  });
});
