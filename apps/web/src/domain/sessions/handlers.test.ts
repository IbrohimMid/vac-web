import { beforeEach, describe, expect, it } from 'vitest';
import { registerSessionHandlers } from './handlers';
import { useSession } from '../../stores/session';
import { useSessions } from '../../stores/sessions';
import type { EventFrame, TransportHandle } from '../../transport';

type Handler = (ev: EventFrame) => void;

function mockTransport() {
  const handlers = new Map<string, Handler[]>();
  const t: TransportHandle = {
    async send() {
      return { ackOf: 'x', ok: true };
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const remaining = handlers.get(type)?.filter((h) => h !== handler) ?? [];
        handlers.set(type, remaining);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown) => {
    const frame: EventFrame = {
      seq: 1,
      session_id: 's',
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('session handlers', () => {
  beforeEach(() => {
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
    useSessions.setState({ rows: [] });
  });

  it('captures ACP auth metadata from session.ready', () => {
    const { t, emit } = mockTransport();
    const off = registerSessionHandlers(t);

    emit('session.ready', {
      id: 'sess_01',
      session_id: 'sess_01',
      profile_id: 'executor.code@1.0.0',
      agent_id: 'claude-agent-acp',
      agent_kind: 'acp',
      workflow_id: 'build.observe-tools',
      workflow_name: 'Tool Observation',
      auth_methods: [
        {
          id: 'claude-login',
          name: 'Log in with Claude Code',
          description: 'Run `claude /login` in the terminal',
        },
      ],
    });

    expect(useSessions.getState().rows[0]?.id).toBe('sess_01');
    expect(useSession.getState().agentId).toBe('claude-agent-acp');
    expect(useSession.getState().agentKind).toBe('acp');
    expect(useSession.getState().workflowId).toBe('build.observe-tools');
    expect(useSession.getState().workflowName).toBe('Tool Observation');
    expect(useSession.getState().authMethods).toHaveLength(1);
    const authMethod = useSession.getState().authMethods[0]!;
    expect(authMethod.type).toBe('agent');
    expect(authMethod.name).toBe('Log in with Claude Code');

    off();
  });

  it('mirrors session.auth_requested into requesting status', () => {
    const { t, emit } = mockTransport();
    const off = registerSessionHandlers(t);

    // Seed a prior failure so we can assert it gets cleared on a fresh
    // request (the bridge always emits auth_requested before talking to
    // the adapter).
    useSession.setState({
      authStatus: 'failed',
      authError: { code: 'auth.unknown', message: 'previous attempt' },
    });

    emit('session.auth_requested', { auth_method_id: 'claude-login' });

    expect(useSession.getState().authStatus).toBe('requesting');
    expect(useSession.getState().authError).toBeNull();
    expect(useSession.getState().lastAuthMethodId).toBe('claude-login');

    off();
  });

  it('marks the session authenticated on session.auth_updated', () => {
    const { t, emit } = mockTransport();
    const off = registerSessionHandlers(t);

    useSession.setState({
      authStatus: 'requesting',
      lastAuthMethodId: 'claude-login',
    });

    emit('session.auth_updated', {
      auth_method_id: 'claude-login',
      auth_method_type: 'agent',
      status: { ok: true },
    });

    expect(useSession.getState().authStatus).toBe('authenticated');
    expect(useSession.getState().authError).toBeNull();
    expect(useSession.getState().lastAuthMethodId).toBe('claude-login');

    off();
  });

  it('captures structured failure on session.auth_failed', () => {
    const { t, emit } = mockTransport();
    const off = registerSessionHandlers(t);

    emit('session.auth_failed', {
      auth_method_id: 'anthropic-key',
      auth_method_type: 'env_var',
      code: 'auth.env_var_recreate_required',
      message: 'export ANTHROPIC_API_KEY then recreate the session',
    });

    const state = useSession.getState();
    expect(state.authStatus).toBe('failed');
    expect(state.authError?.code).toBe('auth.env_var_recreate_required');
    expect(state.authError?.authMethodId).toBe('anthropic-key');
    expect(state.authError?.authMethodType).toBe('env_var');
    expect(state.lastAuthMethodId).toBe('anthropic-key');

    off();
  });
});
