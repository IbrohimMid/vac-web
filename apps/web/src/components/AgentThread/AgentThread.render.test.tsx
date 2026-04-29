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
    // X.5f.3 Patch F: louder placeholder — the working state is now
    // a status region with a spinner glyph and elapsed time, so test
    // by testid + substring rather than by exact ellipsis text.
    const working = screen.getByTestId('agent-working-placeholder');
    expect(working).toBeInTheDocument();
    expect(working).toHaveAttribute('role', 'status');
    expect(working.textContent ?? '').toMatch(/Gemini is working/);
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
  });

  it('shows the empty-turn fallback when a turn completes with no events', () => {
    // X.5f.3 Patch F: a Gemini turn that finishes (transcript.completed)
    // without emitting any assistant text, thought, tool, diff, terminal,
    // or plan must not render as a silent empty card. The fallback note
    // tells the user the turn finished and points them at Retry / Debug.
    const s = useAgentSession.getState();
    s.beginTurn({
      sessionId: 'sess1',
      userText: 'hi',
      provider: 'gemini-acp',
      at: '2026-01-01T00:00:00Z',
    });
    s.completeTextBlocks('sess1', '2026-01-01T00:00:01Z');

    render(<AgentThread sessionId="sess1" />);

    const fallback = screen.getByTestId('agent-empty-turn-fallback');
    expect(fallback).toBeInTheDocument();
    expect(fallback.textContent ?? '').toMatch(/Gemini CLI ACP/);
    expect(fallback.textContent ?? '').toMatch(/finished without emitting any/);
    // The text-only fallback (Patch D) MUST NOT also fire — there were
    // no assistant blocks at all.
    expect(screen.queryByTestId('agent-text-only-fallback')).not.toBeInTheDocument();
    // And the working spinner is gone now that the turn is no longer active.
    expect(screen.queryByTestId('agent-working-placeholder')).not.toBeInTheDocument();
  });

  it('shows the failed-turn fallback wording when a turn fails empty', () => {
    // X.5f.3 Patch F: same fallback fires for a failed empty turn,
    // but with "failed" wording so dogfooders can tell the diff between
    // "completed with nothing" vs "errored with nothing".
    const s = useAgentSession.getState();
    s.beginTurn({
      sessionId: 'sess1',
      userText: 'hi',
      provider: 'gemini-acp',
      at: '2026-01-01T00:00:00Z',
    });
    s.failActiveTurn('sess1', '2026-01-01T00:00:01Z');

    render(<AgentThread sessionId="sess1" />);

    const fallback = screen.getByTestId('agent-empty-turn-fallback');
    expect(fallback.textContent ?? '').toMatch(/failed without emitting any/);
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
    expect(
      screen.getByText('2 messages · 0 tools · no thoughts emitted · no plan emitted'),
    ).toBeInTheDocument();
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

    expect(screen.getByText(/Diagnostics · .* ACP frame/)).toBeInTheDocument();
    expect(screen.getAllByText(/agent_message_chunk/).length).toBeGreaterThan(0);
    expect(screen.getByText(/content_count/)).toBeInTheDocument();
    expect(screen.getByText('abc1234567')).toBeInTheDocument();
  });
  it('renders the opencode_serve sub-agent tap badge instead of the gemini fallback wording', () => {
    // Stage X.5h.2 Step 3b: when the bridge taps the OpenCode sub-agent
    // HTTP API, the FE shows "via opencode sub-agent tap" instead of
    // the X.5f.3 "normalized from <shape> shape" wording (which is for
    // Gemini snake_case fallback DTOs, not for the OpenCode tap which
    // is a real second-source observation, not a normalization).
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'sub-agent probe', provider: 'gemini-acp' });
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'oc_sub_call_xyz',
      kind: 'execute',
      title: 'bash',
      status: 'completed',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      rawShape: 'opencode_serve',
      parentToolCallId: 'tc_parent_task',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    render(<AgentThread sessionId="sess1" />);

    const meta = screen.getByTestId('tool-raw-shape');
    expect(meta.textContent).toContain('via opencode sub-agent tap');
    expect(meta.textContent).not.toContain('normalized from');
  });

  it('keeps the X.5f.3 gemini fallback wording for raw_shape=gemini', () => {
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'gemini probe', provider: 'gemini-acp' });
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'gemini-tc-2',
      kind: 'other',
      title: 'Gemini tool call',
      status: 'completed',
      locations: [],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      rawShape: 'gemini',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    render(<AgentThread sessionId="sess1" />);

    const meta = screen.getByTestId('tool-raw-shape');
    expect(meta.textContent).toContain('normalized from gemini shape');
  });

  it('X.5h.3: renders per-node sub-agent action row on a task tool card with cancel/retry disabled and copy enabled', () => {
    // The bridge marks a sub-agent dispatch by setting `subagent_type` on
    // the tool_call_update payload. The card should surface a Cancel/Retry
    // affordance for that node specifically (in addition to the turn-level
    // ones), with both buttons disabled until the bridge wires per-task
    // abort + re-dispatch. "Copy task description" works whenever the
    // input summary has been extracted.
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'dispatch a sub-agent', provider: 'opencode-acp' });
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_task_root',
      kind: 'other',
      title: 'task',
      status: 'in_progress',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      subagentType: 'general',
      rawInput: { description: 'Investigate the failing test', subagent_type: 'general' },
      updatedAt: '2026-01-01T00:00:00Z',
    });
    render(<AgentThread sessionId="sess1" />);

    const actionsRow = screen.getByTestId('agent-subagent-actions');
    expect(actionsRow).toBeInTheDocument();
    expect(actionsRow.getAttribute('data-subagent-type')).toBe('general');
    expect(actionsRow.getAttribute('data-tool-call-id')).toBe('tc_task_root');

    expect(screen.getByTestId('agent-subagent-cancel')).toBeDisabled();
    expect(screen.getByTestId('agent-subagent-retry')).toBeDisabled();
    // Copy is enabled because inputSummary derives from raw_input.description.
    expect(screen.getByTestId('agent-subagent-copy-description')).not.toBeDisabled();
  });

  it('X.5h.4: tool dispatched before assistant text renders ABOVE the assistant message in the timeline', () => {
    // Repro of the visual bug the user reported: when an agent dispatches a
    // sub-agent and only afterwards writes its summary text, the timeline
    // must place the tool card ABOVE the text (chronologically). Before
    // X.5h.4 we rendered thoughts → assistants → plan → tools in fixed
    // order so the sub-agent card always landed at the bottom regardless
    // of when it actually arrived.
    const s = useAgentSession.getState();
    s.beginTurn({
      sessionId: 'sess1',
      userText: 'coba explore codebase saya dengan sub agents',
      provider: 'opencode-acp',
      at: '2026-01-01T00:00:00.000Z',
    });
    // The agent first dispatches a sub-agent…
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_explore_subagent',
      kind: 'other',
      title: 'Explore vac-web codebase',
      status: 'completed',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      subagentType: 'explore',
      rawInput: { description: 'Explore vac-web codebase', subagent_type: 'explore' },
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    // …and only later streams its summary text.
    s.appendAssistantDelta(
      'sess1',
      '**vac-web** adalah end-to-end software delivery cockpit.',
      '2026-01-01T00:00:05.000Z',
    );
    render(<AgentThread sessionId="sess1" />);

    const timelineEl = screen.getByTestId('agent-turn-timeline');
    const children = Array.from(timelineEl.children) as HTMLElement[];
    // Pick out the indices of the tool card vs the assistant block.
    const toolIdx = children.findIndex((el) =>
      el.matches('details.agent-card.tool'),
    );
    const assistantIdx = children.findIndex((el) =>
      el.getAttribute('data-testid') === 'agent-assistant-block',
    );
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeLessThan(assistantIdx);
  });

  it('X.5h.4: thinking block streamed AFTER an early tool call still renders below it', () => {
    // Belt-and-braces: the chronological invariant must hold for thoughts too.
    const s = useAgentSession.getState();
    s.beginTurn({
      sessionId: 'sess1',
      userText: 'late-thinking turn',
      provider: 'opencode-acp',
      at: '2026-01-01T00:00:00.000Z',
    });
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_early',
      kind: 'execute',
      title: 'bash',
      status: 'completed',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    s.appendThoughtDelta(
      'sess1',
      'Now reflecting on the bash output…',
      '2026-01-01T00:00:10.000Z',
    );
    render(<AgentThread sessionId="sess1" />);

    const timelineEl = screen.getByTestId('agent-turn-timeline');
    const children = Array.from(timelineEl.children) as HTMLElement[];
    const toolIdx = children.findIndex((el) =>
      el.matches('details.agent-card.tool'),
    );
    // ThinkingBlock renders a <details> with summary "Thinking".
    const thinkingIdx = children.findIndex((el) =>
      el.tagName === 'DETAILS' && el.textContent?.includes('Thinking'),
    );
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(thinkingIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeLessThan(thinkingIdx);
  });

  it('X.5h.3: deep-nested sub-agent cards (depth >= 2) start collapsed by default', () => {
    // The FE's collapse threshold mirrors the bridge's MAX_SUBAGENT_DEPTH
    // policy: depth 0 + 1 stay open so the common one-level dispatch is
    // visible at a glance, but anything from depth 2 onward is closed by
    // default so a runaway 4-level tree doesn't dominate the timeline.
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'multi-level dispatch', provider: 'opencode-acp' });
    // Root task (depth 0).
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_d0',
      kind: 'other',
      title: 'task',
      status: 'in_progress',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      subagentType: 'general',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    // Direct child (depth 1) — still open by default.
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_d1',
      kind: 'other',
      title: 'task',
      status: 'in_progress',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      subagentType: 'helper',
      parentToolCallId: 'tc_d0',
      updatedAt: '2026-01-01T00:00:01Z',
    });
    // Depth 2 — default-collapsed.
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc_d2',
      kind: 'execute',
      title: 'bash',
      status: 'in_progress',
      locations: [],
      agentId: 'opencode',
      agentKind: 'opencode',
      approvedByApprovalId: null,
      parentToolCallId: 'tc_d1',
      rawShape: 'opencode_serve',
      updatedAt: '2026-01-01T00:00:02Z',
    });
    render(<AgentThread sessionId="sess1" />);

    const depth1 = screen.getByTestId('agent-tool-card-depth-1');
    const depth2 = screen.getByTestId('agent-tool-card-depth-2');
    expect(depth1.getAttribute('data-depth')).toBe('1');
    expect(depth1).toHaveAttribute('open');
    expect(depth2.getAttribute('data-depth')).toBe('2');
    expect(depth2).not.toHaveAttribute('open');
  });
});
