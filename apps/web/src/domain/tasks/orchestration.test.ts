import { describe, expect, it } from 'vitest';
import { countTaskStatuses, findTaskFileConflicts, summarizeAgentActivity } from './orchestration';
import type { TaskRecord } from '../../stores/tasks';
import type { ToolActivity } from '../../stores/toolActivity';

function task(taskId: string, status: TaskRecord['status'], changedFiles: string[] = [], approvalsNeeded: string[] = []): TaskRecord {
  return {
    taskId,
    sessionId: 's1',
    title: taskId,
    status,
    plan: [],
    activeStepId: null,
    changedFiles,
    commands: [],
    approvalsNeeded,
    validation: null,
    blocker: null,
    errorMessage: null,
    createdAt: '2026-05-14T00:00:00Z',
    updatedAt: '2026-05-14T00:00:00Z',
  };
}

function activity(toolCallId: string, agentId: string, agentKind: string, status: ToolActivity['status'], ts: string): ToolActivity {
  return {
    session_id: 's1',
    agent_id: agentId,
    agent_kind: agentKind,
    tool_call_id: toolCallId,
    kind: 'execute',
    title: `tool ${toolCallId}`,
    status,
    locations: [],
    diffs: [],
    approval_tool_call_hash: null,
    raw_input_hash: null,
    raw_input_redacted: null,
    raw_output_redacted: null,
    approved_by_approval_id: null,
    ts,
    outputTruncated: false,
    outputRedacted: false,
    seq: 1,
  };
}

describe('task orchestration helpers', () => {
  it('counts task status buckets', () => {
    const counts = countTaskStatuses([
      task('a', 'executing'),
      task('b', 'blocked'),
      task('c', 'reviewing', ['x.ts']),
      task('d', 'completed'),
      task('e', 'failed'),
      task('f', 'planned', [], ['appr1']),
    ]);
    expect(counts).toEqual({ active: 3, blocked: 2, needsReview: 1, completed: 1, failed: 1 });
  });

  it('finds same-file conflicts across tasks', () => {
    expect(findTaskFileConflicts([
      task('a', 'executing', ['shared.ts', 'a.ts']),
      task('b', 'planned', ['shared.ts']),
      task('c', 'planned', ['c.ts']),
    ])).toEqual([{ path: 'shared.ts', taskIds: ['a', 'b'] }]);
  });

  it('summarizes specialized agent activity newest first', () => {
    const summaries = summarizeAgentActivity([
      activity('t1', 'agent-a', 'code', 'completed', '2026-05-14T00:00:01Z'),
      activity('t2', 'agent-a', 'code', 'failed', '2026-05-14T00:00:02Z'),
      activity('t3', 'agent-b', 'search', 'in_progress', '2026-05-14T00:00:03Z'),
    ]);
    expect(summaries[0]).toMatchObject({ agentId: 'agent-b', agentKind: 'search', running: 1, latestStatus: 'in_progress' });
    expect(summaries[1]).toMatchObject({ agentId: 'agent-a', total: 2, failed: 1, latestTitle: 'tool t2' });
  });
});
