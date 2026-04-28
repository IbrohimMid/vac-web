import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentDiffKey,
  agentPlanKey,
  agentTerminalKey,
  agentTextKey,
  agentToolKey,
  selectAgentThreadItems,
  selectAgentTurns,
  useAgentSession,
} from './agentSession';

function reset() {
  useAgentSession.getState().clear();
}

describe('agentSession store', () => {
  beforeEach(reset);

  it('appends assistant and thought deltas into separate thread blocks', () => {
    const s = useAgentSession.getState();
    s.appendAssistantDelta('sess1', 'hello ');
    s.appendAssistantDelta('sess1', 'world');
    s.appendThoughtDelta('sess1', 'thinking');

    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant'))?.content).toBe('hello world');
    expect(useAgentSession.getState().thoughts.get(agentTextKey('sess1', 'thought'))?.content).toBe('thinking');
    expect(selectAgentThreadItems('sess1').map((item) => item.kind)).toEqual(['assistant', 'thought']);
  });

  it('upserts a tool call without duplicating the thread item', () => {
    const s = useAgentSession.getState();
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit file',
      status: 'pending',
      locations: [],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit file',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
      agentId: 'gemini-acp',
      agentKind: 'acp',
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:01Z',
    });

    const key = agentToolKey('sess1', 'tc1');
    expect(useAgentSession.getState().tools.get(key)?.status).toBe('completed');
    expect(useAgentSession.getState().tools.get(key)?.locations[0]?.path).toBe('/src/app.ts');
    expect(selectAgentThreadItems('sess1')).toHaveLength(1);
  });

  it('stores diff, terminal, and plan updates', () => {
    const s = useAgentSession.getState();
    s.upsertDiff({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      status: 'completed',
      locations: [{ path: '/src/app.ts' }],
      diffs: [{ path: '/src/app.ts', old_text: 'old', new_text: 'new' }],
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    s.upsertTerminal({
      sessionId: 'sess1',
      toolCallId: 'tc2',
      status: 'completed',
      rawInputRedacted: null,
      rawOutputRedacted: 'ok',
      approvedByApprovalId: null,
      agentId: 'gemini-acp',
      agentKind: 'acp',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    s.updatePlan({
      sessionId: 'sess1',
      entries: [{ id: 'p1', title: 'Inspect context', status: 'completed' }],
      updatedAt: '2026-01-01T00:00:00Z',
    });

    expect(useAgentSession.getState().diffs.get(agentDiffKey('sess1', 'tc1'))?.diffs[0]?.new_text).toBe('new');
    expect(useAgentSession.getState().terminals.get(agentTerminalKey('sess1', 'tc2'))?.rawOutputRedacted).toBe('ok');
    expect(useAgentSession.getState().plans.get(agentPlanKey('sess1'))?.entries[0]?.title).toBe('Inspect context');
    expect(selectAgentThreadItems('sess1').map((item) => item.kind)).toEqual(['plan']);
  });

  it('clearSession removes only the target session', () => {
    const s = useAgentSession.getState();
    s.appendAssistantDelta('sess1', 'one');
    s.appendAssistantDelta('sess2', 'two');
    s.clearSession('sess1');

    expect(selectAgentThreadItems('sess1')).toHaveLength(0);
    expect(selectAgentThreadItems('sess2')).toHaveLength(1);
  });

  it('starts a new assistant block after completion', () => {
    const s = useAgentSession.getState();
    s.appendAssistantDelta('sess1', 'first');
    s.completeTextBlocks('sess1');
    s.appendAssistantDelta('sess1', 'second');

    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant', 1))?.content).toBe('first');
    expect(useAgentSession.getState().assistants.get(agentTextKey('sess1', 'assistant', 2))?.content).toBe('second');
    expect(selectAgentThreadItems('sess1').map((item) => item.kind)).toEqual(['assistant', 'assistant']);
  });

  it('groups user prompt and streaming deltas into an active turn', () => {
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'hi', provider: 'gemini-acp', at: '2026-01-01T00:00:00Z' });

    expect(selectAgentTurns('sess1')).toMatchObject([
      { userText: 'hi', provider: 'gemini-acp', status: 'working', startedAt: '2026-01-01T00:00:00Z' },
    ]);

    s.appendAssistantDelta('sess1', 'hello', '2026-01-01T00:00:01Z');

    const turn = selectAgentTurns('sess1')[0];
    expect(turn?.status).toBe('streaming');
    expect(turn?.assistantBlockIds).toEqual([agentTextKey('sess1', 'assistant')]);
    expect(useAgentSession.getState().telemetry.get('sess1')?.eventCounts.message).toBe(1);
    expect(useAgentSession.getState().telemetry.get('sess1')?.promptStatus).toBe('streaming');
  });

  it('marks the active turn completed or failed', () => {
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'hi', provider: 'gemini-acp', at: '2026-01-01T00:00:00Z' });
    s.completeTextBlocks('sess1', '2026-01-01T00:00:03Z');

    expect(selectAgentTurns('sess1')[0]).toMatchObject({ status: 'completed', completedAt: '2026-01-01T00:00:03Z' });
    expect(useAgentSession.getState().telemetry.get('sess1')?.promptStatus).toBe('completed');

    s.beginTurn({ sessionId: 'sess1', userText: 'again', provider: 'gemini-acp', at: '2026-01-01T00:00:04Z' });
    s.failActiveTurn('sess1', '2026-01-01T00:00:05Z');

    expect(selectAgentTurns('sess1')[1]).toMatchObject({ status: 'failed', completedAt: '2026-01-01T00:00:05Z' });
    expect(useAgentSession.getState().telemetry.get('sess1')?.promptStatus).toBe('failed');
  });

  it('attaches thought, tool, diff, terminal, and plan events to a turn and telemetry', () => {
    const s = useAgentSession.getState();
    s.beginTurn({ sessionId: 'sess1', userText: 'code', provider: 'gemini-acp' });
    s.appendThoughtDelta('sess1', 'think');
    s.upsertToolCall({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      kind: 'edit',
      title: 'Edit file',
      status: 'in_progress',
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
      locations: [],
      diffs: [{ path: '/tmp/a.ts', old_text: 'a', new_text: 'b' }],
      approvedByApprovalId: null,
      updatedAt: '2026-01-01T00:00:01Z',
    });
    s.upsertTerminal({
      sessionId: 'sess1',
      toolCallId: 'tc1',
      status: 'completed',
      rawInputRedacted: null,
      rawOutputRedacted: 'ok',
      approvedByApprovalId: null,
      agentId: 'gemini-acp',
      agentKind: 'acp',
      updatedAt: '2026-01-01T00:00:02Z',
    });
    s.updatePlan({
      sessionId: 'sess1',
      entries: [{ id: 'p1', title: 'Inspect', status: 'completed' }],
      updatedAt: '2026-01-01T00:00:03Z',
    });

    const turn = selectAgentTurns('sess1')[0];
    expect(turn?.thinkingBlockIds).toEqual([agentTextKey('sess1', 'thought')]);
    expect(turn?.toolCallIds).toEqual([agentToolKey('sess1', 'tc1')]);
    expect(turn?.planId).toBe(agentPlanKey('sess1'));
    expect(useAgentSession.getState().telemetry.get('sess1')?.eventCounts).toMatchObject({
      thought: 1,
      tool: 1,
      diff: 1,
      terminal: 1,
      plan: 1,
    });
  });
});
