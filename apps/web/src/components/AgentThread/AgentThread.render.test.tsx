// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentSession } from '../../stores/agentSession';
import { useSession } from '../../stores/session';
import { AgentThread } from './AgentThread';

function reset() {
  useAgentSession.getState().clear();
  useSession.setState({ sessionId: 'sess1' });
}

describe('AgentThread renderer', () => {
  beforeEach(reset);
  afterEach(cleanup);

  it('renders thought block collapsed and expandable', () => {
    useAgentSession.getState().appendThoughtDelta('sess1', 'I should inspect context.');
    render(<AgentThread sessionId="sess1" />);

    const details = screen.getByText(/Thinking collapsed/).closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/Thinking collapsed/));
    expect(screen.getByText('I should inspect context.')).toBeInTheDocument();
  });

  it('renders tool card updates pending to completed', () => {
    const s = useAgentSession.getState();
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit app.ts',
      status: 'pending',
      locations: [],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const { rerender } = render(<AgentThread sessionId="sess1" />);
    expect(screen.getByText('pending')).toBeInTheDocument();

    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit app.ts',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:01Z',
    });
    rerender(<AgentThread sessionId="sess1" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('/src/app.ts')).toBeInTheDocument();
  });

  it('renders diff card path and +/- preview', () => {
    const s = useAgentSession.getState();
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit app.ts',
      status: 'completed',
      locations: [],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    s.upsertDiff({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
      diffs: [{ path: '/src/app.ts', old_text: 'const oldValue = 1;', new_text: 'const newValue = 2;' }],
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    render(<AgentThread sessionId="sess1" />);
    expect(screen.getByText('Diff update')).toBeInTheDocument();
    expect(screen.getAllByText('/src/app.ts')[0]).toBeInTheDocument();
    expect(screen.getByText('- const oldValue = 1;')).toBeInTheDocument();
    expect(screen.getByText('+ const newValue = 2;')).toBeInTheDocument();
  });

  it('renders terminal card with redacted and truncated output', () => {
    const s = useAgentSession.getState();
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'execute',
      title: 'Run command',
      status: 'completed',
      locations: [],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    s.upsertTerminal({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      status: 'completed',
      rawInputRedacted: null,
      rawOutputRedacted: `TOKEN=sk-ant-SECRETSECRETSECRET ${'x'.repeat(700)}`,
      approvedByApprovalId: null,
      agentId: 'gemini-acp',
      agentKind: 'acp',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    render(<AgentThread sessionId="sess1" />);
    expect(screen.getByText('Terminal output')).toBeInTheDocument();
    expect(screen.getByText(/<REDACTED-SECRET>/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-ant-SECRET/)).not.toBeInTheDocument();
    expect(screen.getByText('redacted')).toBeInTheDocument();
    expect(screen.getByText('truncated')).toBeInTheDocument();
  });

  it('renders plan status list', () => {
    useAgentSession.getState().updatePlan({
      sessionId: 'sess1',
      entries: [
        { id: 'p1', title: 'Inspect context', status: 'completed' },
        { id: 'p2', title: 'Apply edit', status: 'in_progress' },
      ],
      updatedAt: '2026-01-01T00:00:00Z',
    });

    render(<AgentThread sessionId="sess1" />);
    expect(screen.getByRole('region', { name: 'Rich agent thread' })).toBeInTheDocument();
    expect(screen.getByText('Inspect context')).toBeInTheDocument();
    expect(screen.getByText('Apply edit')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('in_progress')).toBeInTheDocument();
  });
});
