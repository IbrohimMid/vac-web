import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentDiffKey,
  agentPlanKey,
  agentTerminalKey,
  agentTextKey,
  agentToolKey,
  selectAgentThreadItems,
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
});
