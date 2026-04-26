// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReauthAction } from './ReauthAction';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

function baseTransport(
  send: TransportHandle['send'] = vi.fn(async () => ({ ackOf: 'x', ok: true })),
): TransportHandle {
  return {
    send,
    on: () => () => {},
    close: () => {},
  };
}

function resetSession() {
  useSession.setState({
    sessionId: 'sess_01',
    profileId: 'executor.code@1.0.0',
    projectRoot: '/tmp/demo',
    workflowId: null,
    workflowName: null,
    agentId: 'claude-agent-acp',
    agentKind: 'acp',
    authMethods: [
      { id: 'claude-login', name: 'Log in with Claude', type: 'agent' },
    ],
    authStatus: 'idle',
    authError: null,
    lastAuthMethodId: null,
  });
}

describe('cockpit ReauthAction', () => {
  beforeEach(() => {
    resetSession();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the session is not ACP', () => {
    useSession.setState({ agentKind: 'cli', authMethods: [] });
    const { container } = render(<ReauthAction transport={baseTransport()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no auth methods are advertised', () => {
    useSession.setState({ authMethods: [] });
    const { container } = render(<ReauthAction transport={baseTransport()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends bridge-owned session.authenticate on click', () => {
    const send = vi.fn(async () => ({ ackOf: 'x', ok: true }));
    render(<ReauthAction transport={baseTransport(send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Reauth: Log in with Claude/ }));

    expect(send).toHaveBeenCalledWith(
      'sess_01',
      'session.authenticate',
      { auth_method_id: 'claude-login' },
    );
    // Optimistic flip happens before the bridge confirms.
    expect(useSession.getState().authStatus).toBe('requesting');
    expect(useSession.getState().lastAuthMethodId).toBe('claude-login');
  });

  it('shows the failed status surface from the store', () => {
    useSession.setState({
      authStatus: 'failed',
      authError: {
        code: 'auth.terminal_capability_disabled',
        message: 'terminal capability is held off',
        authMethodId: 'terminal-login',
        authMethodType: 'terminal',
      },
      lastAuthMethodId: 'terminal-login',
    });
    render(<ReauthAction transport={baseTransport()} />);
    const status = screen.getByTestId('reauth-status');
    expect(status).toHaveAttribute('data-auth-status', 'failed');
    expect(status).toHaveTextContent('auth.terminal_capability_disabled');
    expect(status).toHaveTextContent('terminal capability is held off');
  });

  it('flips to failed when the transport rejects before the bridge acks', async () => {
    const send = vi.fn(async () => {
      throw new Error('socket closed');
    });
    render(<ReauthAction transport={baseTransport(send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Reauth: Log in with Claude/ }));
    // Wait a microtask for the rejected promise to flush.
    await Promise.resolve();
    await Promise.resolve();

    const state = useSession.getState();
    expect(state.authStatus).toBe('failed');
    expect(state.authError?.code).toBe('auth.transport_error');
    expect(state.authError?.message).toContain('socket closed');
  });

  it('ack ok=false flips authStatus failed and surfaces ack error', async () => {
    // Cover the path where the bridge resolves a structured ack with
    // `ok=false` but no `session.auth_failed` lifecycle event arrives
    // (e.g. the translator-level `session.not_found` short-circuit on a
    // stale session id). The button must fail-closed instead of staying
    // in `requesting`.
    const send = vi.fn(async () => ({
      ackOf: 'cmd_x',
      ok: false,
      error: { code: 'session.not_found', message: 'sess_01' },
    }));
    render(<ReauthAction transport={baseTransport(send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Reauth: Log in with Claude/ }));
    // Flush microtasks so the ack handler runs.
    await Promise.resolve();
    await Promise.resolve();

    const state = useSession.getState();
    expect(state.authStatus).toBe('failed');
    expect(state.authError?.code).toBe('session.not_found');
    expect(state.authError?.message).toBe('sess_01');
    expect(state.authError?.authMethodId).toBe('claude-login');
    expect(state.authError?.authMethodType).toBe('agent');
  });

  it('ack ok=true with no error keeps requesting until lifecycle event lands', async () => {
    // ack.ok=true is purely a delivery confirmation here — the visual
    // state must still come from the bridge's `session.auth_updated` /
    // `session.auth_failed` event. Until that arrives the button stays
    // in `requesting` (which is the optimistic state set on click).
    const send = vi.fn(async () => ({ ackOf: 'cmd_x', ok: true }));
    render(<ReauthAction transport={baseTransport(send)} />);

    fireEvent.click(screen.getByRole('button', { name: /Reauth: Log in with Claude/ }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useSession.getState().authStatus).toBe('requesting');
    expect(useSession.getState().authError).toBeNull();
  });
});
