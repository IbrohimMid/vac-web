// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentSession } from '../../stores/agentSession';
import { useSession } from '../../stores/session';
import { AgentThread } from './AgentThread';

function reset() {
  useAgentSession.getState().clear();
  useSession.setState({ sessionId: 'sess1', agentId: 'gemini-acp' });
}

describe('AgentThread renderer', () => {
  beforeEach(reset);
  afterEach(cleanup);

  it('renders thought block collapsed and expandable', () => {
    useAgentSession.getState().appendThoughtDelta('sess1', 'I should inspect context.');
    render(<AgentThread sessionId="sess1" />);

    const details = screen.getByText(/Thinking/).closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/Thinking/));
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

  it('renders a working Gemini turn before rich events arrive', () => {
    useAgentSession.getState().beginTurn({
      sessionId: 'sess1',
      userText: 'hi',
      provider: 'gemini-acp',
      at: '2026-01-01T00:00:00Z',
    });

    render(<AgentThread sessionId="sess1" />);

    expect(screen.getByText('Gemini CLI ACP')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('Gemini is working…')).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
  });

  it('keeps turns separated and shows telemetry counts', () => {
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'first', provider: 'gemini-acp' });
    s.appendAssistantDelta('sess1', 'one');
    s.completeTextBlocks('sess1');
    s.beginTurn({ sessionId: 'sess1', userText: 'second', provider: 'gemini-acp' });
    s.appendAssistantDelta('sess1', 'two');

    render(<AgentThread sessionId="sess1" />);

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText(/two/)).toBeInTheDocument();
    expect(screen.getByText('2 deltas')).toBeInTheDocument();
    expect(screen.getByText('0 tools')).toBeInTheDocument();
    expect(screen.getByText('0 thoughts')).toBeInTheDocument();
    expect(screen.getByText('0 plans')).toBeInTheDocument();
  });

  it('renders ACP debug discriminators and safe preview', () => {
    useAgentSession.getState().recordDebugMessage({
      sessionId: 'sess1',
      direction: 'incoming',
      messageType: 'notification',
      method: 'session/update',
      discriminator: 'agent_message_chunk',
      paramsPreview: '{"sessionUpdate":"agent_message_chunk","content_count":1}',
      paramsHash: 'abc123456789',
      ts: '2026-01-01T00:00:00Z',
    });

    render(<AgentThread sessionId="sess1" />);

    expect(screen.getByText('ACP Debug')).toBeInTheDocument();
    expect(screen.getAllByText(/agent_message_chunk/).length).toBeGreaterThan(0);
    expect(screen.getByText(/content_count/)).toBeInTheDocument();
    expect(screen.getByText('abc1234567')).toBeInTheDocument();
  });
});
