// Unit-level tests for ToolActivityLane behaviour — driven through the store,
// not through DOM rendering (no @testing-library in this codebase).
//
// The rendering contract is verified indirectly: correct store state → correct
// data arrays → components that iterate them produce correct output.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  useToolActivity,
  nextSeq,
  actKey,
  selectSessionActivities,
  selectSessionAcpLogs,
  selectSessionInlineDiffs,
  selectHasTaskFailure,
  type ToolActivity,
  type AcpJobLog,
  type InlineReviewDiff,
} from '../../stores/toolActivity';

// ── helpers ────────────────────────────────────────────────────────────────

function reset() {
  useToolActivity.setState({
    activities: new Map(),
    activityOrder: [],
    acpLogs: new Map(),
    acpLogOrder: [],
    inlineDiffs: new Map(),
    inlineDiffOrder: [],
    diagnostics: {
      observed: 0, updated: 0, failed: 0,
      invalidPayload: 0, redactedOutput: 0, truncatedOutput: 0,
      approvalCorrelated: 0, observedOnly: 0,
    },
  });
}

function act(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    session_id: 's1', agent_id: 'a1', agent_kind: 'acp',
    tool_call_id: 'tc1', kind: 'read', title: null,
    status: 'pending', locations: [], diffs: [],
    approval_tool_call_hash: null, raw_input_hash: null,
    raw_input_redacted: {}, raw_output_redacted: null,
    approved_by_approval_id: null,
    ts: '2026-01-01T00:00:00Z',
    outputTruncated: false, outputRedacted: false,
    seq: nextSeq(),
    ...overrides,
  };
}

function log(overrides: Partial<AcpJobLog> = {}): AcpJobLog {
  return {
    session_id: 's1', tool_call_id: 'tc1', agent_id: 'a1',
    command: 'ls', output: 'file.txt', status: 'completed',
    approved_by_approval_id: null, truncated: false, redacted: false,
    ts: '2026-01-01T00:00:00Z', seq: nextSeq(),
    ...overrides,
  };
}

function diff(overrides: Partial<InlineReviewDiff> = {}): InlineReviewDiff {
  return {
    session_id: 's1', tool_call_id: 'tc1',
    status: 'completed',
    locations: [{ path: '/a.ts' }],
    diffs: [{ path: '/a.ts', new_text: 'new', old_text: 'old' }],
    approved_by_approval_id: null,
    ts: '2026-01-01T00:00:00Z', seq: nextSeq(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ToolActivityLane (store-driven)', () => {
  beforeEach(reset);

  // 1. Activity renders read path — store has correct kind
  it('read activity has kind=read', () => {
    useToolActivity.getState().applyToolObserved(act({ kind: 'read' }));
    const items = selectSessionActivities('s1');
    expect(items[0]?.kind).toBe('read');
  });

  // 2. Activity renders edit
  it('edit activity has kind=edit', () => {
    useToolActivity.getState().applyToolObserved(act({ kind: 'edit' }));
    expect(selectSessionActivities('s1')[0]?.kind).toBe('edit');
  });

  // 3. Activity renders execute
  it('execute activity has kind=execute', () => {
    useToolActivity.getState().applyToolObserved(act({ kind: 'execute' }));
    expect(selectSessionActivities('s1')[0]?.kind).toBe('execute');
  });

  // 4. Activity renders failed warning (status=failed in store)
  it('failed activity has status=failed', () => {
    useToolActivity.getState().applyToolFailed(act({ status: 'failed', kind: 'edit' }));
    expect(selectSessionActivities('s1')[0]?.status).toBe('failed');
  });

  // 5. Activity renders approved badge (approved_by_approval_id present)
  it('approved badge — approved_by_approval_id set', () => {
    useToolActivity.getState().applyToolObserved(
      act({ approved_by_approval_id: 'appr_01' }),
    );
    expect(selectSessionActivities('s1')[0]?.approved_by_approval_id).toBe('appr_01');
  });

  // 6. Activity renders observed-only badge (no approval_id)
  it('observed-only — approved_by_approval_id null', () => {
    useToolActivity.getState().applyToolObserved(act({ approved_by_approval_id: null }));
    expect(selectSessionActivities('s1')[0]?.approved_by_approval_id).toBeNull();
  });

  // 7. Review renders diff path
  it('review diff has path', () => {
    useToolActivity.getState().applyInlineDiff(diff());
    expect(selectSessionInlineDiffs('s1')[0]?.diffs[0]?.path).toBe('/a.ts');
  });

  // 8. Review renders new text
  it('review diff has new_text', () => {
    useToolActivity.getState().applyInlineDiff(diff());
    expect(selectSessionInlineDiffs('s1')[0]?.diffs[0]?.new_text).toBe('new');
  });

  // 9. Review renders old text
  it('review diff has old_text', () => {
    useToolActivity.getState().applyInlineDiff(diff());
    expect(selectSessionInlineDiffs('s1')[0]?.diffs[0]?.old_text).toBe('old');
  });

  // 10. Review handles new file (old_text null)
  it('new file diff has old_text=null', () => {
    useToolActivity.getState().applyInlineDiff(
      diff({ diffs: [{ path: '/new.ts', new_text: 'content', old_text: null }] }),
    );
    expect(selectSessionInlineDiffs('s1')[0]?.diffs[0]?.old_text).toBeNull();
  });

  // 11. Review multi-file diffs stored
  it('review stores multi-file diffs', () => {
    useToolActivity.getState().applyInlineDiff(
      diff({
        diffs: [
          { path: '/a.ts', new_text: 'a', old_text: null },
          { path: '/b.ts', new_text: 'b', old_text: 'bo' },
        ],
      }),
    );
    expect(selectSessionInlineDiffs('s1')[0]?.diffs).toHaveLength(2);
  });

  // 12. Runtime renders command
  it('runtime log has command', () => {
    useToolActivity.getState().applyAcpJobLog(log({ command: 'cargo test' }));
    expect(selectSessionAcpLogs('s1')[0]?.command).toBe('cargo test');
  });

  // 13. Runtime renders output
  it('runtime log has output', () => {
    useToolActivity.getState().applyAcpJobLog(log({ output: 'test ok' }));
    expect(selectSessionAcpLogs('s1')[0]?.output).toBe('test ok');
  });

  // 14. Runtime renders redaction notice
  it('runtime log redacted flag set', () => {
    useToolActivity.getState().applyAcpJobLog(log({ redacted: true }));
    expect(selectSessionAcpLogs('s1')[0]?.redacted).toBe(true);
    expect(useToolActivity.getState().diagnostics.redactedOutput).toBe(1);
  });

  // 15. Runtime renders truncation notice
  it('runtime log truncated flag set', () => {
    useToolActivity.getState().applyAcpJobLog(log({ truncated: true }));
    expect(selectSessionAcpLogs('s1')[0]?.truncated).toBe(true);
    expect(useToolActivity.getState().diagnostics.truncatedOutput).toBe(1);
  });

  // 16. Runtime renders failed command as warning (status=failed, not bridge crash)
  it('failed execute tool status=failed not bridge error', () => {
    useToolActivity.getState().applyToolFailed(act({ kind: 'execute', status: 'failed' }));
    expect(useToolActivity.getState().diagnostics.failed).toBe(1);
    expect(useToolActivity.getState().diagnostics.invalidPayload).toBe(0);
  });

  // 17. Approval-then-tool timeline sequence: bridge sends approval_id on every update
  it('timeline: approval_id preserved across observed→updated', () => {
    useToolActivity.getState().applyToolObserved(
      act({ tool_call_id: 'tc1', approved_by_approval_id: 'appr_01', seq: 1 }),
    );
    // Bridge re-sends approved_by_approval_id on the tool_call_update too
    useToolActivity.getState().applyToolUpdated(
      act({ tool_call_id: 'tc1', status: 'completed', approved_by_approval_id: 'appr_01', seq: 2 }),
    );
    const items = selectSessionActivities('s1');
    expect(items[0]?.approved_by_approval_id).toBe('appr_01');
    expect(items[0]?.status).toBe('completed');
  });

  // 18. Diagnostics counts invalid payload
  it('invalid payload count increments', () => {
    useToolActivity.getState().recordInvalidPayload();
    useToolActivity.getState().recordInvalidPayload();
    expect(useToolActivity.getState().diagnostics.invalidPayload).toBe(2);
  });

  // 19. Unknown event does not crash store (no throw from applyToolObserved)
  it('applyToolObserved with minimal data does not throw', () => {
    expect(() =>
      useToolActivity.getState().applyToolObserved(act({ title: null, diffs: [], locations: [] })),
    ).not.toThrow();
  });

  // 20. Malformed diff (missing path) — store accepts what it's given
  it('diff with empty diffs array stored cleanly', () => {
    useToolActivity.getState().applyInlineDiff(diff({ diffs: [] }));
    expect(selectSessionInlineDiffs('s1')[0]?.diffs).toHaveLength(0);
  });

  // 21. Session task failure is not global crash (selectHasTaskFailure true, no error diagnostic)
  it('task failure is not bridge error', () => {
    useToolActivity.getState().applyToolFailed(act({ status: 'failed' }));
    expect(selectHasTaskFailure('s1')).toBe(true);
    expect(useToolActivity.getState().diagnostics.invalidPayload).toBe(0);
  });

  // 22. Empty Activity — zero items for fresh session
  it('empty activity for fresh session', () => {
    expect(selectSessionActivities('new-session')).toHaveLength(0);
  });

  // 23. Empty Review — zero diffs for fresh session
  it('empty diffs for fresh session', () => {
    expect(selectSessionInlineDiffs('new-session')).toHaveLength(0);
  });

  // 24. Empty Runtime — zero logs for fresh session
  it('empty logs for fresh session', () => {
    expect(selectSessionAcpLogs('new-session')).toHaveLength(0);
  });

  // 25. Multiple sessions don't cross-contaminate
  it('two sessions do not mix activities', () => {
    useToolActivity.getState().applyToolObserved(act({ session_id: 's1', tool_call_id: 'tc_a' }));
    useToolActivity.getState().applyToolObserved(act({ session_id: 's2', tool_call_id: 'tc_b' }));
    expect(selectSessionActivities('s1').map((a) => a.tool_call_id)).toEqual(['tc_a']);
    expect(selectSessionActivities('s2').map((a) => a.tool_call_id)).toEqual(['tc_b']);
  });

  // 26. actKey separator prevents prefix collision
  it('actKey with separator prevents collision', () => {
    expect(actKey('s', '1abc')).not.toBe(actKey('s1', 'abc'));
  });

  // 27. AcpJobLog captures approved_by_approval_id
  it('acpLog captures approved_by_approval_id', () => {
    useToolActivity.getState().applyAcpJobLog(log({ approved_by_approval_id: 'appr_02' }));
    expect(selectSessionAcpLogs('s1')[0]?.approved_by_approval_id).toBe('appr_02');
  });

  // 28. locations stored in activity
  it('locations stored in activity', () => {
    useToolActivity.getState().applyToolObserved(
      act({ locations: [{ path: '/src/main.ts', line: 42 }] }),
    );
    expect(selectSessionActivities('s1')[0]?.locations[0]?.line).toBe(42);
  });

  // 29. raw_input_hash stored in activity
  it('raw_input_hash stored', () => {
    useToolActivity.getState().applyToolObserved(act({ raw_input_hash: 'hash123' }));
    expect(selectSessionActivities('s1')[0]?.raw_input_hash).toBe('hash123');
  });

  // 30. approval_tool_call_hash stored in activity
  it('approval_tool_call_hash stored', () => {
    useToolActivity.getState().applyToolObserved(act({ approval_tool_call_hash: 'callhash' }));
    expect(selectSessionActivities('s1')[0]?.approval_tool_call_hash).toBe('callhash');
  });
});
