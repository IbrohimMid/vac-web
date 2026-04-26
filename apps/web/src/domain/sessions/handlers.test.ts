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
});
