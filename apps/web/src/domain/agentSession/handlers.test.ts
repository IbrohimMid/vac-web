import { beforeEach, describe, expect, it } from 'vitest';
import { registerAgentSessionHandlers } from './handlers';
import {
  agentDiffKey,
  agentPlanKey,
  agentTerminalKey,
  agentTextKey,
  agentToolKey,
  useAgentSession,
} from '../../stores/agentSession';
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
        handlers.set(type, handlers.get(type)?.filter((h) => h !== handler) ?? []);
      };
    },
    close() {},
  };
  const emit = (type: string, payload: unknown, sessionId = 'sess1') => {
    const frame: EventFrame = {
      seq: 1,
      session_id: sessionId,
      type,
      payload,
      v: 1,
      ts: '2026-01-01T00:00:00Z',
    };
    for (const h of handlers.get(type) ?? []) h(frame);
  };
  return { t, emit };
}

describe('agentSession handlers', () => {
  beforeEach(() => useAgentSession.getState().clear());

  it('routes assistant and thought deltas separately', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('transcript.delta', { delta: 'assistant' });
    emit('transcript.thought_delta', { delta: 'thinking' });
    emit('transcript.delta', { delta: 'legacy thought', kind: 'thought' });

    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant'))?.content).toBe('assistant');
    expect(useAgentSession.getState().thoughts.get(agentTextKey('sess1', 'thought'))?.content).toBe('thinking');
    off();
  });

  it('upserts tool cards from created and updated events', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('tool.call.created', {
      tool_call_id: 'tc1',
      kind: 'edit',
      title: 'Edit proposed',
      status: 'pending',
    });
    emit('tool.call.updated', {
      tool_call_id: 'tc1',
      kind: 'edit',
      title: 'Edit proposed',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
    });

    const tool = useAgentSession.getState().tools.get(agentToolKey('sess1', 'tc1'));
    expect(tool?.status).toBe('completed');
    expect(tool?.locations[0]?.path).toBe('/src/app.ts');
    off();
  });

  it('captures diff, terminal, and plan updates', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('tool.diff.updated', {
      tool_call_id: 'tc1',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
      diffs: [{ path: '/src/app.ts', old_text: '-old', new_text: '+new' }],
    });
    emit('tool.terminal.updated', {
      tool_call_id: 'tc2',
      status: 'completed',
      raw_output_redacted: 'ok',
    });
    emit('plan.updated', {
      entries: [
        { id: 'p1', title: 'Inspect context', status: 'completed' },
        { id: 'p2', title: 'Apply edit', status: 'in_progress' },
      ],
    });

    expect(useAgentSession.getState().diffs.get(agentDiffKey('sess1', 'tc1'))?.diffs[0]?.path).toBe('/src/app.ts');
    expect(useAgentSession.getState().terminals.get(agentTerminalKey('sess1', 'tc2'))?.rawOutputRedacted).toBe('ok');
    expect(useAgentSession.getState().plans.get(agentPlanKey('sess1'))?.entries.map((entry) => entry.title)).toEqual([
      'Inspect context',
      'Apply edit',
    ]);
    off();
  });
});
