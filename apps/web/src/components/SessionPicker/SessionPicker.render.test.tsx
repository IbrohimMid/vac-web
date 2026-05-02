// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionPicker } from './SessionPicker';
import { useSession } from '../../stores/session';
import { useAgentSession } from '../../stores/agentSession';
import { useTranscript } from '../../stores/transcript';
import type { AvailableAgent, TransportHandle } from '../../transport';

// SessionPicker reads `agentId` from useSession to decide whether the
// active-session badge should render. Resetting the slice keeps each
// test isolated.
function resetSession() {
  useAgentSession.getState().clear();
  useTranscript.getState().clear();
  useSession.setState({
    sessionId: null,
    profileId: null,
    projectRoot: null,
    workflowId: null,
    workflowName: null,
    agentId: null,
    agentKind: null,
    authMethods: [],
    authStatus: 'idle',
    authError: null,
    lastAuthMethodId: null,
  });
}

function makeTransport(
  available: AvailableAgent[],
  send: TransportHandle['send'] = vi.fn(
    async () => ({ ackOf: 'cmd_x', ok: true }),
  ),
): TransportHandle {
  return {
    send,
    on: () => () => {},
    availableAgents: () => available,
    close: () => {},
  };
}

const CLAUDE: AvailableAgent = {
  id: 'claude-acp',
  label: 'Claude Agent ACP',
  kind: 'acp',
  default: true,
};
const GEMINI: AvailableAgent = {
  id: 'gemini-acp',
  label: 'Gemini CLI ACP',
  kind: 'acp',
  default: false,
};
const OPENCODE_MISSING: AvailableAgent = {
  id: 'opencode',
  label: 'OpenCode',
  kind: 'acp',
  default: false,
  installed: false,
  install_hint: 'Install OpenCode: see https://opencode.ai/docs/install',
};
const KIMI_MISSING_NO_HINT: AvailableAgent = {
  id: 'kimi-cli-acp',
  label: 'Kimi CLI',
  kind: 'acp',
  default: false,
  installed: false,
};

describe('SessionPicker provider picker', () => {
  beforeEach(resetSession);
  afterEach(cleanup);

  it('renders bridge agent warning when no available_agents advertised', () => {
    render(<SessionPicker transport={makeTransport([])} />);
    expect(screen.queryByLabelText('Agent')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No agents advertised by bridge. Restart bridge with fixtures/agents.multi.toml.',
    );
    expect(screen.getByText('Agent registry: unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create session/ })).toBeDisabled();
  });

  it('renders an option per advertised agent and marks the default', () => {
    render(<SessionPicker transport={makeTransport([CLAUDE, GEMINI])} />);
    const select = screen.getByLabelText('Agent') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual(['claude-acp', 'gemini-acp']);
    // The default flag is surfaced as a textual marker so users can
    // tell which agent the bridge would have picked anyway.
    const [first, second] = options;
    expect(first?.textContent).toContain('(default)');
    expect(second?.textContent).not.toContain('(default)');
    expect(select.value).toBe('claude-acp');
  });

  it('forwards the picked agent_id in the session.create payload', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd_x', ok: true }));
    render(<SessionPicker transport={makeTransport([CLAUDE, GEMINI], send)} />);

    fireEvent.change(screen.getByLabelText('Agent'), {
      target: { value: 'gemini-acp' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create session/ }));
    // Flush the create() async chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
    // `vi.fn(async () => ...)` infers param tuple from the arrow's
    // empty signature, so we recover the structural call shape via a
    // cast rather than a destructure of the inferred `[]`.
    const call = send.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(call[1]).toBe('session.create');
    // Stage X.4 wire shape: agent_id is the bridge-side selector that
    // routes session.create away from default_agent without mutating the
    // global registry.
    expect(call[2]).toMatchObject({
      profile_id: 'executor.code@1.0.0',
      workflow_id: 'build.observe-tools',
      agent_id: 'gemini-acp',
    });
  });

  it('does not create a session when the bridge advertised no agents', () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd_x', ok: true }));
    render(<SessionPicker transport={makeTransport([], send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Create session/ }));

    expect(send).not.toHaveBeenCalled();
  });

  it('renders an install-hint warning and “not installed” marker when selected agent is missing on PATH', () => {
    // Stage X.5e: simulate a bridge welcome where OpenCode is
    // advertised but the binary is absent. The picker must:
    //  1. mark the option label with a “• not installed” suffix so
    //     operators can spot it before opening the dropdown,
    //  2. surface the operator-supplied install_hint verbatim in
    //     a status block, so the cockpit doubles as runbook for
    //     the install/auth flow,
    //  3. NOT disable Create session — spawn-time error remains the
    //     authoritative truth in case the operator has a shim.
    render(<SessionPicker transport={makeTransport([CLAUDE, OPENCODE_MISSING])} />);
    const select = screen.getByLabelText('Agent') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'opencode' } });
    const hint = screen.getByTestId('agent-install-hint');
    expect(hint).toHaveTextContent('OpenCode');
    expect(hint).toHaveTextContent('not\u00A0installed on this host.'.replace('\u00A0', ' '));
    expect(hint).toHaveTextContent('https://opencode.ai/docs/install');
    expect(hint).toHaveTextContent('spawn error');
    // Marker on the unselected list option as well, so users
    // notice it before they pick it.
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.find((o) => o.value === 'opencode')?.textContent).toContain('not installed');
    expect(options.find((o) => o.value === 'claude-acp')?.textContent).not.toContain('not installed');
    // Create button stays enabled — the bridge spawn failure is the
    // authoritative source of truth.
    expect(screen.getByRole('button', { name: /Create session/ })).not.toBeDisabled();
  });

  it('hides the install-hint warning when the selected agent reports installed: true (or undefined for legacy bridges)', () => {
    // CLAUDE has no `installed` field at all (legacy bridge
    // shape) — the picker must NOT show a warning, treating
    // `undefined` as "unknown, no warning" so old bridges keep
    // working.
    render(<SessionPicker transport={makeTransport([CLAUDE, GEMINI])} />);
    expect(screen.queryByTestId('agent-install-hint')).toBeNull();
  });


  it('continues an active Gemini session in another advertised CLI agent', async () => {
    useSession.setState({
      sessionId: 'sess_gemini',
      profileId: 'executor.code@1.0.0',
      projectRoot: '/repo',
      workflowId: 'build.observe-tools',
      workflowName: 'Tool Observation',
      agentId: 'gemini-acp',
      agentKind: 'acp',
      authMethods: [],
      authStatus: 'idle',
      authError: null,
      lastAuthMethodId: null,
    });
    useAgentSession.getState().beginTurn({
      sessionId: 'sess_gemini',
      userText: 'audit repo saya secara menyeluruh',
      provider: 'gemini-acp',
      at: '2026-05-02T00:00:00.000Z',
    });
    useAgentSession.getState().appendAssistantDelta(
      'sess_gemini',
      'Initial audit started with Gemini.',
      '2026-05-02T00:00:01.000Z',
    );

    const handlers = new Map<string, Parameters<TransportHandle['on']>[1]>();
    const send = vi.fn(async () => ({ ackOf: 'cmd_x', ok: true }));
    const transport: TransportHandle = {
      send,
      on: (type, handler) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
      availableAgents: () => [CLAUDE, GEMINI],
      close: () => {},
    };

    render(<SessionPicker transport={transport} />);

    expect(screen.getByTestId('cross-agent-continuation')).toHaveTextContent(
      'Continue with another CLI agent',
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue in selected agent/ }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const createCall = send.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(createCall[1]).toBe('session.create');
    expect(createCall[2]).toMatchObject({
      profile_id: 'executor.code@1.0.0',
      project_root: '/repo',
      workflow_id: 'build.observe-tools',
      agent_id: 'claude-acp',
      continuation_of: 'sess_gemini',
    });

    const ready = handlers.get('session.ready');
    expect(ready).toBeTruthy();
    ready?.({
      seq: 1,
      session_id: 'sess_claude',
      type: 'session.ready',
      payload: {
        session_id: 'sess_claude',
        profile_id: 'executor.code@1.0.0',
        project_root: '/repo',
        workflow_id: 'build.observe-tools',
        agent_id: 'claude-acp',
        agent_kind: 'acp',
      },
      v: 1,
      ts: '2026-05-02T00:00:02.000Z',
    });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const submitCall = send.mock.calls[1] as unknown as [string, string, Record<string, unknown>];
    expect(submitCall[0]).toBe('sess_claude');
    expect(submitCall[1]).toBe('message.submit');
    expect(submitCall[2].text).toContain('cross-agent continuation');
    expect(submitCall[2].text).toContain('Source VAC session: sess_gemini');
    expect(submitCall[2].text).toContain('Source agent: gemini-acp');
    expect(submitCall[2].text).toContain('Target agent: claude-acp');
    expect(submitCall[2].text).toContain('audit repo saya secara menyeluruh');
    expect(submitCall[2]).toMatchObject({ attachments: [], mentions: [] });
  });

  it('renders the warning without an install_hint sentence when the bridge omitted it', () => {
    // Forward-compat: an agent flagged installed=false but with
    // no install_hint must still show the warning + spawn-error
    // caveat — the operator just gets less guidance.
    render(<SessionPicker transport={makeTransport([CLAUDE, KIMI_MISSING_NO_HINT])} />);
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'kimi-cli-acp' } });
    const hint = screen.getByTestId('agent-install-hint');
    expect(hint).toHaveTextContent('Kimi CLI');
    expect(hint).toHaveTextContent('spawn error');
    expect(hint.textContent).not.toMatch(/install:.*see/i);
  });
});
