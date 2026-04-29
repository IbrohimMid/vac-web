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

  it('splits assistant blocks across completed events during replay', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('transcript.delta', { delta: 'first' });
    emit('transcript.completed', {});
    emit('transcript.delta', { delta: 'second' });

    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant', 1))?.content).toBe('first');
    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant', 2))?.content).toBe('second');
    expect(useAgentSession.getState().telemetry.get('sess1')?.promptStatus).toBe('streaming');
    off();
  });

  it('tracks provider, completion, errors, and rich event telemetry', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('session.ready', { agent_id: 'gemini-acp' });
    useAgentSession.getState().beginTurn({ sessionId: 'sess1', userText: 'hi', provider: 'gemini-acp' });
    emit('transcript.delta', { delta: 'hello' });
    emit('transcript.completed', {});

    expect(useAgentSession.getState().telemetry.get('sess1')).toMatchObject({
      providerId: 'gemini-acp',
      promptStatus: 'completed',
    });
    expect(useAgentSession.getState().telemetry.get('sess1')?.eventCounts.message).toBe(1);

    useAgentSession.getState().beginTurn({ sessionId: 'sess1', userText: 'again', provider: 'gemini-acp' });
    emit('transcript.error', { error: 'boom' });

    expect(useAgentSession.getState().telemetry.get('sess1')?.promptStatus).toBe('failed');
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

  it('renders a minimal Gemini-shape tool_call without crashing on empty fields', () => {
    // X.5f.3 Patch A FE consumer acceptance. The bridge fills in a
    // fallback DTO (kind=other, title="Gemini tool call",
    // status=pending, raw_shape="gemini") when Gemini CLI ACP
    // emits a snake_case tool_call frame. The FE must accept this
    // payload, surface the rawShape hint, and bump telemetry.tool
    // even though locations / diffs / rawInput / rawOutput are all
    // empty.
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    useAgentSession.getState().beginTurn({ sessionId: 'sess1', userText: 'gemini probe', provider: 'gemini-acp' });
    emit('tool.call.created', {
      tool_call_id: 'gemini-tc-1',
      kind: 'other',
      title: 'Gemini tool call',
      status: 'pending',
      raw_shape: 'gemini',
      agent_id: 'gemini-acp',
    });
    emit('tool.call.updated', {
      tool_call_id: 'gemini-tc-1',
      kind: 'other',
      title: 'Gemini tool call',
      status: 'completed',
      raw_shape: 'gemini',
      agent_id: 'gemini-acp',
    });

    const tool = useAgentSession.getState().tools.get(agentToolKey('sess1', 'gemini-tc-1'));
    expect(tool).toBeDefined();
    expect(tool?.toolCallId).toBe('gemini-tc-1');
    expect(tool?.kind).toBe('other');
    expect(tool?.title).toBe('Gemini tool call');
    expect(tool?.status).toBe('completed');
    expect(tool?.rawShape).toBe('gemini');
    // Empty locations must be tolerated, not crash the renderer.
    expect(tool?.locations).toEqual([]);

    // Telemetry tool count must reach >= 1 so the provider header
    // can stop saying "no tool emitted" once a Gemini tool_call
    // is seen on the wire.
    const telemetry = useAgentSession.getState().telemetry.get('sess1');
    expect(telemetry?.eventCounts.tool ?? 0).toBeGreaterThanOrEqual(1);
    off();
  });

  it('captures sub-agent tool from opencode_serve tap with parent_tool_call_id', () => {
    // Stage X.5h.2 Step 3b: when the bridge taps the OpenCode sub-agent
    // HTTP API, it forwards each inner tool call as `tool.call.created`/
    // `tool.call.updated` with a namespaced `oc_sub_*` tool_call_id,
    // raw_shape: "opencode_serve", and the parent task tool_call_id
    // snapshot. The FE must store all three so the AgentThread renderer
    // can nest the sub-tool under its parent task card.
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('tool.call.created', {
      tool_call_id: 'oc_sub_call_abc',
      kind: 'execute',
      title: 'bash',
      status: 'in_progress',
      raw_shape: 'opencode_serve',
      agent_id: 'opencode',
      agent_kind: 'opencode',
      parent_tool_call_id: 'tc_parent_task',
      raw_input_redacted: { command: 'echo hi', description: 'probe' },
    });
    emit('tool.call.updated', {
      tool_call_id: 'oc_sub_call_abc',
      kind: 'execute',
      title: 'bash',
      status: 'completed',
      raw_shape: 'opencode_serve',
      agent_id: 'opencode',
      agent_kind: 'opencode',
      parent_tool_call_id: 'tc_parent_task',
      raw_input_redacted: { command: 'echo hi', description: 'probe' },
      raw_output_redacted: 'hi\n',
    });

    const tool = useAgentSession.getState().tools.get(agentToolKey('sess1', 'oc_sub_call_abc'));
    expect(tool).toBeDefined();
    expect(tool?.toolCallId).toBe('oc_sub_call_abc');
    expect(tool?.kind).toBe('execute');
    expect(tool?.status).toBe('completed');
    expect(tool?.rawShape).toBe('opencode_serve');
    expect(tool?.parentToolCallId).toBe('tc_parent_task');
    expect(tool?.subagentType ?? null).toBeNull();
    // raw_output_redacted should propagate through the upsert.
    expect(tool?.rawOutput).toBe('hi\n');
    off();
  });

  it('captures sub-agent diff and terminal updates with namespaced oc_sub ids', () => {
    // Stage X.5h.2 Step 3b: diff + terminal lanes for sub-tool keep the
    // namespaced `oc_sub_*` tool_call_id so the FE store routes the
    // attachments to the correct sub-tool card (not the parent task).
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('tool.diff.updated', {
      tool_call_id: 'oc_sub_call_edit',
      status: 'completed',
      locations: [{ path: '/src/lib.rs' }],
      diffs: [{ path: '/src/lib.rs', old_text: 'a', new_text: 'b' }],
      parent_tool_call_id: 'tc_parent_task',
    });
    emit('tool.terminal.updated', {
      tool_call_id: 'oc_sub_call_bash',
      status: 'completed',
      raw_input_redacted: { command: 'ls' },
      raw_output_redacted: 'README.md\n',
      agent_id: 'opencode',
      agent_kind: 'opencode',
      parent_tool_call_id: 'tc_parent_task',
    });

    const diff = useAgentSession.getState().diffs.get(agentDiffKey('sess1', 'oc_sub_call_edit'));
    expect(diff?.diffs[0]?.path).toBe('/src/lib.rs');
    expect(diff?.toolCallId).toBe('oc_sub_call_edit');

    const term = useAgentSession.getState().terminals.get(agentTerminalKey('sess1', 'oc_sub_call_bash'));
    expect(term?.rawOutputRedacted).toBe('README.md\n');
    expect(term?.toolCallId).toBe('oc_sub_call_bash');
    expect(term?.agentId).toBe('opencode');
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
    expect(useAgentSession.getState().telemetry.get('sess1')?.eventCounts).toMatchObject({
      diff: 1,
      terminal: 1,
      plan: 1,
    });
    off();
  });

  it('captures ACP debug discriminators and safe previews', () => {
    const { t, emit } = mockTransport();
    const off = registerAgentSessionHandlers(t);

    emit('acp.debug_message', {
      direction: 'incoming',
      message_type: 'notification',
      method: 'session/update',
      params_preview: { sessionUpdate: 'agent_message_chunk', content_count: 1 },
      params_hash: 'abc123456789',
    });

    const telemetry = useAgentSession.getState().telemetry.get('sess1');
    expect(telemetry?.eventCounts.debug).toBe(1);
    expect(telemetry?.discriminators.agent_message_chunk).toBe(1);
    expect(telemetry?.debugMessages[0]).toMatchObject({
      direction: 'incoming',
      method: 'session/update',
      discriminator: 'agent_message_chunk',
      paramsHash: 'abc123456789',
    });
    expect(telemetry?.debugMessages[0]?.paramsPreview).toContain('content_count');
    off();
  });
});
