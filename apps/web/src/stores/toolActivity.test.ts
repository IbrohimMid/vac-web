import { beforeEach, describe, expect, it } from 'vitest';
import {
  useToolActivity,
  actKey,
  nextSeq,
  capMapByOrder,
  selectSessionActivities,
  selectSessionAcpLogs,
  selectSessionInlineDiffs,
  selectHasTaskFailure,
  type ToolActivity,
  type AcpJobLog,
  type InlineReviewDiff,
} from './toolActivity';

function reset() {
  useToolActivity.setState({
    activities: new Map(),
    activityOrder: [],
    acpLogs: new Map(),
    acpLogOrder: [],
    inlineDiffs: new Map(),
    inlineDiffOrder: [],
    diagnostics: {
      observed: 0,
      updated: 0,
      failed: 0,
      invalidPayload: 0,
      redactedOutput: 0,
      truncatedOutput: 0,
      approvalCorrelated: 0,
      observedOnly: 0,
    },
  });
}

function makeActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    session_id: 'sess1',
    agent_id: 'agent1',
    agent_kind: 'acp',
    tool_call_id: 'tc1',
    kind: 'read',
    title: 'Read file.txt',
    status: 'pending',
    locations: [{ path: '/tmp/file.txt', line: null }],
    diffs: [],
    approval_tool_call_hash: 'abc123',
    raw_input_hash: 'def456',
    raw_input_redacted: { file_path: '/tmp/file.txt' },
    raw_output_redacted: null,
    approved_by_approval_id: null,
    ts: '2026-01-01T00:00:00Z',
    outputTruncated: false,
    outputRedacted: false,
    seq: nextSeq(),
    ...overrides,
  };
}

function makeLog(overrides: Partial<AcpJobLog> = {}): AcpJobLog {
  return {
    session_id: 'sess1',
    tool_call_id: 'tc1',
    agent_id: 'agent1',
    command: 'echo hi',
    output: 'hi',
    status: 'completed',
    approved_by_approval_id: null,
    truncated: false,
    redacted: false,
    ts: '2026-01-01T00:00:00Z',
    seq: nextSeq(),
    ...overrides,
  };
}

function makeDiff(overrides: Partial<InlineReviewDiff> = {}): InlineReviewDiff {
  return {
    session_id: 'sess1',
    tool_call_id: 'tc1',
    status: 'completed',
    locations: [{ path: '/tmp/edit.ts' }],
    diffs: [{ path: '/tmp/edit.ts', new_text: 'new', old_text: 'old' }],
    approved_by_approval_id: null,
    ts: '2026-01-01T00:00:00Z',
    seq: nextSeq(),
    ...overrides,
  };
}

describe('toolActivity store', () => {
  beforeEach(reset);

  // 1. applyToolObserved creates a new activity entry
  it('applyToolObserved creates activity', () => {
    useToolActivity.getState().applyToolObserved(makeActivity());
    const s = useToolActivity.getState();
    expect(s.activityOrder).toHaveLength(1);
    expect(s.activities.get(actKey('sess1', 'tc1'))?.kind).toBe('read');
  });

  // 2. applyToolUpdated merges on same tool_call_id (no duplicate in order)
  it('applyToolUpdated merges same tool_call_id', () => {
    useToolActivity.getState().applyToolObserved(makeActivity({ status: 'pending' }));
    useToolActivity.getState().applyToolUpdated(makeActivity({ status: 'completed' }));
    const s = useToolActivity.getState();
    expect(s.activityOrder).toHaveLength(1);
    expect(s.activities.get(actKey('sess1', 'tc1'))?.status).toBe('completed');
  });

  // 3. applyToolFailed marks the activity as failed
  it('applyToolFailed marks status failed', () => {
    useToolActivity.getState().applyToolFailed(makeActivity({ status: 'failed' }));
    expect(useToolActivity.getState().activities.get(actKey('sess1', 'tc1'))?.status).toBe('failed');
  });

  // 4. duplicate observed dedupes in order list
  it('duplicate observed does not add to order', () => {
    useToolActivity.getState().applyToolObserved(makeActivity());
    useToolActivity.getState().applyToolObserved(makeActivity());
    expect(useToolActivity.getState().activityOrder).toHaveLength(1);
  });

  // 5. diagnostics.observed increments
  it('observed increments diagnostic counter', () => {
    useToolActivity.getState().applyToolObserved(makeActivity());
    expect(useToolActivity.getState().diagnostics.observed).toBe(1);
  });

  // 6. diagnostics.updated increments
  it('updated increments diagnostic counter', () => {
    useToolActivity.getState().applyToolUpdated(makeActivity({ status: 'completed' }));
    expect(useToolActivity.getState().diagnostics.updated).toBe(1);
  });

  // 7. diagnostics.failed increments
  it('failed increments diagnostic counter', () => {
    useToolActivity.getState().applyToolFailed(makeActivity({ status: 'failed' }));
    expect(useToolActivity.getState().diagnostics.failed).toBe(1);
  });

  // 8. applyInlineDiff creates diff entry
  it('applyInlineDiff creates diff', () => {
    useToolActivity.getState().applyInlineDiff(makeDiff());
    const s = useToolActivity.getState();
    expect(s.inlineDiffOrder).toHaveLength(1);
    expect(s.inlineDiffs.get(actKey('sess1', 'tc1'))?.diffs[0]?.path).toBe('/tmp/edit.ts');
  });

  // 9. applyInlineDiff same tool_call_id updates existing entry
  it('applyInlineDiff same tool_call_id updates', () => {
    useToolActivity.getState().applyInlineDiff(makeDiff({ status: 'pending' }));
    useToolActivity.getState().applyInlineDiff(makeDiff({ status: 'completed' }));
    const s = useToolActivity.getState();
    expect(s.inlineDiffOrder).toHaveLength(1);
    expect(s.inlineDiffs.get(actKey('sess1', 'tc1'))?.status).toBe('completed');
  });

  // 10. applyAcpJobLog creates log entry
  it('applyAcpJobLog creates log', () => {
    useToolActivity.getState().applyAcpJobLog(makeLog());
    expect(useToolActivity.getState().acpLogOrder).toHaveLength(1);
    expect(useToolActivity.getState().acpLogs.get(actKey('sess1', 'tc1'))?.command).toBe('echo hi');
  });

  // 11. applyAcpJobLog updates on same tool_call_id
  it('applyAcpJobLog updates on same key', () => {
    useToolActivity.getState().applyAcpJobLog(makeLog({ output: 'v1' }));
    useToolActivity.getState().applyAcpJobLog(makeLog({ output: 'v2' }));
    expect(useToolActivity.getState().acpLogOrder).toHaveLength(1);
    expect(useToolActivity.getState().acpLogs.get(actKey('sess1', 'tc1'))?.output).toBe('v2');
  });

  // 12. approved_by_approval_id recorded + correlates counter
  it('approval badge preserved in activity', () => {
    useToolActivity.getState().applyToolObserved(
      makeActivity({ approved_by_approval_id: 'appr_01' }),
    );
    const a = useToolActivity.getState().activities.get(actKey('sess1', 'tc1'));
    expect(a?.approved_by_approval_id).toBe('appr_01');
    expect(useToolActivity.getState().diagnostics.approvalCorrelated).toBe(1);
  });

  // 13. unapproved activity increments observedOnly
  it('unapproved increments observedOnly', () => {
    useToolActivity.getState().applyToolObserved(makeActivity({ approved_by_approval_id: null }));
    expect(useToolActivity.getState().diagnostics.observedOnly).toBe(1);
  });

  // 14. raw_input_hash alone does NOT create approval correlation
  it('raw_input_hash alone does not correlate', () => {
    useToolActivity.getState().applyToolObserved(
      makeActivity({ approved_by_approval_id: null, raw_input_hash: 'samehash' }),
    );
    const a = useToolActivity.getState().activities.get(actKey('sess1', 'tc1'));
    expect(a?.approved_by_approval_id).toBeNull();
  });

  // 15. recordInvalidPayload increments counter
  it('invalid payload increments counter', () => {
    useToolActivity.getState().recordInvalidPayload();
    expect(useToolActivity.getState().diagnostics.invalidPayload).toBe(1);
  });

  // 16. outputRedacted flag set when marker present
  it('redacted marker sets outputRedacted flag', () => {
    useToolActivity.getState().applyToolUpdated(
      makeActivity({ raw_output_redacted: 'ok <REDACTED-SECRET> end', outputRedacted: true }),
    );
    expect(useToolActivity.getState().activities.get(actKey('sess1', 'tc1'))?.outputRedacted).toBe(true);
    expect(useToolActivity.getState().diagnostics.redactedOutput).toBe(1);
  });

  // 17. outputTruncated flag set when marker present
  it('truncation marker sets outputTruncated flag', () => {
    useToolActivity.getState().applyToolUpdated(
      makeActivity({ raw_output_redacted: 'data\n…[truncated by VAC bridge]', outputTruncated: true }),
    );
    expect(useToolActivity.getState().activities.get(actKey('sess1', 'tc1'))?.outputTruncated).toBe(true);
    expect(useToolActivity.getState().diagnostics.truncatedOutput).toBe(1);
  });

  // 18. acpLog truncated flag increments truncatedOutput
  it('truncated log increments truncatedOutput diagnostic', () => {
    useToolActivity.getState().applyAcpJobLog(makeLog({ truncated: true }));
    expect(useToolActivity.getState().diagnostics.truncatedOutput).toBe(1);
  });

  // 19. acpLog redacted flag increments redactedOutput
  it('redacted log increments redactedOutput diagnostic', () => {
    useToolActivity.getState().applyAcpJobLog(makeLog({ redacted: true }));
    expect(useToolActivity.getState().diagnostics.redactedOutput).toBe(1);
  });

  // 20. caps activity list at 500
  it('caps activities at ACTIVITY_CAP (spot check key)', () => {
    for (let i = 0; i < 510; i++) {
      useToolActivity.getState().applyToolObserved(
        makeActivity({ tool_call_id: `tc${i}`, seq: nextSeq() }),
      );
    }
    expect(useToolActivity.getState().activityOrder.length).toBe(500);
  });

  // 21. caps acpLogs at 500
  it('caps acpLogs at LOG_CAP', () => {
    for (let i = 0; i < 510; i++) {
      useToolActivity.getState().applyAcpJobLog(makeLog({ tool_call_id: `tc${i}`, seq: nextSeq() }));
    }
    expect(useToolActivity.getState().acpLogOrder.length).toBe(500);
  });

  // 22. clearSession removes only that session's data
  it('clearSession removes only target session', () => {
    useToolActivity.getState().applyToolObserved(makeActivity({ session_id: 'sess1', tool_call_id: 'tc1' }));
    useToolActivity.getState().applyToolObserved(makeActivity({ session_id: 'sess2', tool_call_id: 'tc2' }));
    useToolActivity.getState().clearSession('sess1');
    const s = useToolActivity.getState();
    expect(s.activityOrder).toHaveLength(1);
    expect(s.activityOrder[0]).toBe(actKey('sess2', 'tc2'));
  });

  // 23. clear removes all data
  it('clear removes all data', () => {
    useToolActivity.getState().applyToolObserved(makeActivity());
    useToolActivity.getState().applyAcpJobLog(makeLog());
    useToolActivity.getState().applyInlineDiff(makeDiff());
    useToolActivity.getState().clear();
    const s = useToolActivity.getState();
    expect(s.activityOrder).toHaveLength(0);
    expect(s.acpLogOrder).toHaveLength(0);
    expect(s.inlineDiffOrder).toHaveLength(0);
  });

  // 24. selectSessionActivities returns activities for a session
  it('selectSessionActivities returns correct session', () => {
    useToolActivity.getState().applyToolObserved(makeActivity({ session_id: 'sess1', tool_call_id: 'a' }));
    useToolActivity.getState().applyToolObserved(makeActivity({ session_id: 'sess2', tool_call_id: 'b' }));
    const result = selectSessionActivities('sess1');
    expect(result).toHaveLength(1);
    expect(result[0]?.tool_call_id).toBe('a');
  });

  // 25. selectHasTaskFailure returns true when any activity is failed
  it('selectHasTaskFailure true when failed activity exists', () => {
    useToolActivity.getState().applyToolFailed(makeActivity({ status: 'failed' }));
    expect(selectHasTaskFailure('sess1')).toBe(true);
  });

  // 26. selectHasTaskFailure false when no failed activity
  it('selectHasTaskFailure false without failures', () => {
    useToolActivity.getState().applyToolObserved(makeActivity({ status: 'pending' }));
    expect(selectHasTaskFailure('sess1')).toBe(false);
  });

  // 27. failed tool does NOT increment bridge error (it's a task warning)
  it('failed tool keeps diagnostics.failed only, not a bridge error concept', () => {
    useToolActivity.getState().applyToolFailed(makeActivity({ status: 'failed' }));
    // No bridge error field; task failure is separate from bridge crash
    expect(useToolActivity.getState().diagnostics.failed).toBe(1);
    expect(useToolActivity.getState().diagnostics.invalidPayload).toBe(0);
  });

  // 28. selectSessionAcpLogs returns correct session logs
  it('selectSessionAcpLogs returns correct session', () => {
    useToolActivity.getState().applyAcpJobLog(makeLog({ session_id: 'sess1', tool_call_id: 'l1' }));
    useToolActivity.getState().applyAcpJobLog(makeLog({ session_id: 'sess2', tool_call_id: 'l2' }));
    const logs = selectSessionAcpLogs('sess1');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.tool_call_id).toBe('l1');
  });

  // 29. selectSessionInlineDiffs returns correct session diffs
  it('selectSessionInlineDiffs returns correct session', () => {
    useToolActivity.getState().applyInlineDiff(makeDiff({ session_id: 'sess1', tool_call_id: 'd1' }));
    useToolActivity.getState().applyInlineDiff(makeDiff({ session_id: 'sess2', tool_call_id: 'd2' }));
    const diffs = selectSessionInlineDiffs('sess1');
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.tool_call_id).toBe('d1');
  });

  // 30. diffs preserved in activity
  it('diffs preserved in activity', () => {
    const a = makeActivity({
      kind: 'edit',
      diffs: [{ path: '/x.ts', new_text: 'new', old_text: 'old' }],
    });
    useToolActivity.getState().applyToolObserved(a);
    const stored = useToolActivity.getState().activities.get(actKey('sess1', 'tc1'));
    expect(stored?.diffs[0]?.path).toBe('/x.ts');
    expect(stored?.diffs[0]?.new_text).toBe('new');
    expect(stored?.diffs[0]?.old_text).toBe('old');
  });
});

// ── capMapByOrder unit tests ───────────────────────────────────────────────

describe('capMapByOrder', () => {
  it('returns same map reference when under cap', () => {
    const map = new Map([['a', 1], ['b', 2]]);
    const order = ['a', 'b'];
    const result = capMapByOrder(map, order, 10);
    expect(result.map).toBe(map);
    expect(result.order).toEqual(order);
  });

  it('evicts oldest entries from map when order exceeds cap', () => {
    const map = new Map([['k1', 'v1'], ['k2', 'v2'], ['k3', 'v3']]);
    const { map: nextMap, order: nextOrder } = capMapByOrder(map, ['k1', 'k2', 'k3'], 2);
    expect(nextOrder).toEqual(['k2', 'k3']);
    expect(nextMap.has('k1')).toBe(false);
    expect(nextMap.size).toBe(2);
  });

  it('map and order stay in sync after eviction', () => {
    const map = new Map<string, number>();
    const order: string[] = [];
    for (let i = 0; i < 10; i++) { map.set(`k${i}`, i); order.push(`k${i}`); }
    const { map: nextMap, order: nextOrder } = capMapByOrder(map, order, 5);
    expect(nextOrder.length).toBe(5);
    expect(nextMap.size).toBe(5);
    for (const k of nextOrder) expect(nextMap.has(k)).toBe(true);
  });
});

// ── Map-eviction integration tests ────────────────────────────────────────

describe('toolActivity store — map eviction', () => {
  beforeEach(reset);

  it('cap removes evicted activity map entries', () => {
    for (let i = 0; i < 510; i++) {
      useToolActivity.getState().applyToolObserved(
        makeActivity({ tool_call_id: `tc${i}`, seq: nextSeq() }),
      );
    }
    const s = useToolActivity.getState();
    expect(s.activityOrder.length).toBe(500);
    expect(s.activities.size).toBe(500);
    expect(s.activities.has(actKey('sess1', 'tc0'))).toBe(false);
    expect(s.activities.has(actKey('sess1', 'tc9'))).toBe(false);
  });

  it('cap removes evicted runtime log map entries', () => {
    for (let i = 0; i < 510; i++) {
      useToolActivity.getState().applyAcpJobLog(
        makeLog({ tool_call_id: `tc${i}`, seq: nextSeq() }),
      );
    }
    const s = useToolActivity.getState();
    expect(s.acpLogOrder.length).toBe(500);
    expect(s.acpLogs.size).toBe(500);
    expect(s.acpLogs.has(actKey('sess1', 'tc0'))).toBe(false);
  });

  it('cap removes evicted inline diff map entries', () => {
    for (let i = 0; i < 310; i++) {
      useToolActivity.getState().applyInlineDiff(
        makeDiff({ tool_call_id: `tc${i}`, seq: nextSeq() }),
      );
    }
    const s = useToolActivity.getState();
    expect(s.inlineDiffOrder.length).toBe(300);
    expect(s.inlineDiffs.size).toBe(300);
    expect(s.inlineDiffs.has(actKey('sess1', 'tc0'))).toBe(false);
  });
});
