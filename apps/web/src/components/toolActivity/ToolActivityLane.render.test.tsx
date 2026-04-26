// @vitest-environment happy-dom
// DOM render tests for ToolActivityLane + RuntimeTab/ReviewTab ACP sections.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useToolActivity, nextSeq, type ToolActivity } from '../../stores/toolActivity';
import { useSession } from '../../stores/session';
import { ToolActivityLane } from './ToolActivityLane';

function resetStores() {
  useToolActivity.setState({
    activities: new Map(),
    activityOrder: [],
    acpLogs: new Map(),
    acpLogOrder: [],
    inlineDiffs: new Map(),
    inlineDiffOrder: [],
    diagnostics: {
      observed: 0, updated: 0, failed: 0,
      invalidPayload: 0, redactedOutput: 0, truncatedOutput: 0,
      approvalCorrelated: 0, observedOnly: 0,
    },
  });
  useSession.setState({ sessionId: 'sess1' });
}

function seedActivity(overrides: Partial<ToolActivity> = {}) {
  useToolActivity.getState().applyToolObserved({
    session_id: 'sess1',
    agent_id: 'agent1',
    agent_kind: 'acp',
    tool_call_id: 'tc1',
    kind: 'read',
    title: null,
    status: 'pending',
    locations: [{ path: '/tmp/notes.txt', line: null }],
    diffs: [],
    approval_tool_call_hash: null,
    raw_input_hash: null,
    raw_input_redacted: {},
    raw_output_redacted: null,
    approved_by_approval_id: null,
    ts: '2026-01-01T00:00:00Z',
    outputTruncated: false,
    outputRedacted: false,
    seq: nextSeq(),
    ...overrides,
  });
}

describe('ToolActivityLane DOM rendering', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  // 1. Empty state renders "No tool activity yet."
  it('renders empty state message', () => {
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('No tool activity yet.')).toBeInTheDocument();
  });

  // 2. Renders "Observed read" for read-kind activity
  it('renders "Observed read" for read kind', () => {
    seedActivity({ kind: 'read', status: 'pending' });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Observed read')).toBeInTheDocument();
  });

  // 3. Renders "Edit proposed" for edit-kind activity
  it('renders "Edit proposed" for edit kind', () => {
    seedActivity({ kind: 'edit', status: 'pending' });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Edit proposed')).toBeInTheDocument();
  });

  // 4. Renders "Command executed" for execute-kind activity
  it('renders "Command executed" for execute kind', () => {
    seedActivity({ kind: 'execute', status: 'completed' });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Command executed')).toBeInTheDocument();
  });

  // 5. Renders "Approved by you" badge when approved_by_approval_id set
  it('renders "Approved by you" badge', () => {
    seedActivity({ approved_by_approval_id: 'appr_01' });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Approved by you')).toBeInTheDocument();
  });

  // 6. Renders "Observed only" badge when no approval
  it('renders "Observed only" badge when unapproved', () => {
    seedActivity({ kind: 'read', approved_by_approval_id: null });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Observed only')).toBeInTheDocument();
  });

  // 7. Renders "Output redacted" notice when flag set
  it('renders "Output redacted" notice', () => {
    seedActivity({
      raw_output_redacted: 'some <REDACTED-SECRET> output',
      outputRedacted: true,
      status: 'completed',
    });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Output redacted')).toBeInTheDocument();
  });

  // 8. Renders "Rejected / task failed" badge for failed status
  it('renders "Rejected / task failed" for failed status', () => {
    useToolActivity.getState().applyToolFailed({
      session_id: 'sess1', agent_id: 'a1', agent_kind: 'acp',
      tool_call_id: 'tc1', kind: 'edit', title: null,
      status: 'failed', locations: [], diffs: [],
      approval_tool_call_hash: null, raw_input_hash: null,
      raw_input_redacted: {}, raw_output_redacted: null,
      approved_by_approval_id: null,
      ts: '2026-01-01T00:00:00Z',
      outputTruncated: false, outputRedacted: false, seq: nextSeq(),
    });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Rejected / task failed')).toBeInTheDocument();
  });

  // 9. Renders file path from locations
  it('renders file path from locations', () => {
    seedActivity({ locations: [{ path: '/src/app.ts', line: null }] });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('/src/app.ts')).toBeInTheDocument();
  });

  // 10. Renders "Output truncated" notice when flag set
  it('renders "Output truncated" notice', () => {
    seedActivity({
      raw_output_redacted: 'data\n…[truncated by VAC bridge]',
      outputTruncated: true,
      status: 'completed',
    });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Output truncated')).toBeInTheDocument();
  });

  // 11. Activity lane has aria-label
  it('has aria-label "ACP tool activity"', () => {
    seedActivity();
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByRole('region', { name: 'ACP tool activity' })).toBeInTheDocument();
  });

  // 12. Two activities both rendered
  it('renders multiple activities', () => {
    seedActivity({ tool_call_id: 'tc1', kind: 'read', session_id: 'sess1' });
    useToolActivity.getState().applyToolObserved({
      session_id: 'sess1', agent_id: 'a1', agent_kind: 'acp',
      tool_call_id: 'tc2', kind: 'edit', title: null,
      status: 'pending', locations: [], diffs: [],
      approval_tool_call_hash: null, raw_input_hash: null,
      raw_input_redacted: {}, raw_output_redacted: null,
      approved_by_approval_id: null,
      ts: '2026-01-01T00:00:00Z',
      outputTruncated: false, outputRedacted: false, seq: nextSeq(),
    });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Observed read')).toBeInTheDocument();
    expect(screen.getByText('Edit proposed')).toBeInTheDocument();
  });

  // 13. Shows header with count when activities present
  it('shows header with count', () => {
    seedActivity();
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('Tool Activity (1)')).toBeInTheDocument();
  });

  // 14. Does not render activities from other sessions
  it('does not render activities from other sessions', () => {
    useToolActivity.getState().applyToolObserved({
      session_id: 'other-sess', agent_id: 'a1', agent_kind: 'acp',
      tool_call_id: 'tc_other', kind: 'execute', title: 'Run something',
      status: 'completed', locations: [], diffs: [],
      approval_tool_call_hash: null, raw_input_hash: null,
      raw_input_redacted: {}, raw_output_redacted: null,
      approved_by_approval_id: null,
      ts: '2026-01-01T00:00:00Z',
      outputTruncated: false, outputRedacted: false, seq: nextSeq(),
    });
    render(<ToolActivityLane sessionId="sess1" />);
    expect(screen.getByText('No tool activity yet.')).toBeInTheDocument();
    expect(screen.queryByText('Command executed')).not.toBeInTheDocument();
  });
});
