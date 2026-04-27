// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionPicker } from './SessionPicker';
import { useSession } from '../../stores/session';
import type { AvailableAgent, TransportHandle } from '../../transport';

// SessionPicker reads `agentId` from useSession to decide whether the
// active-session badge should render. Resetting the slice keeps each
// test isolated.
function resetSession() {
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

describe('SessionPicker provider picker', () => {
  beforeEach(resetSession);
  afterEach(cleanup);

  it('omits the agent dropdown when the bridge advertises no agents (legacy single-binary shim)', () => {
    render(<SessionPicker transport={makeTransport([])} />);
    expect(screen.queryByLabelText('Agent')).toBeNull();
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

  it('omits agent_id when the bridge advertised no agents (back-compat with single-binary shim)', async () => {
    const send = vi.fn(async () => ({ ackOf: 'cmd_x', ok: true }));
    render(<SessionPicker transport={makeTransport([], send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Create session/ }));
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    // The bridge resolves its implicit default in this case; sending an
    // empty agent_id would short-circuit to `agent.not_registered`.
    expect(call[2]).not.toHaveProperty('agent_id');
  });
});
