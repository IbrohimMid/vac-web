// X.5c.2 ACP tool activity store — observe-only tool stream per session.
//
// Consumes: tool.observed / tool.updated / tool.failed / review.changeset_updated
//           / runtime.job_log
// Produces: no commands; read-only surface.

import { create } from 'zustand';

// ── Types matching bridge ObservedToolActivity ─────────────────────────────

export type ToolKind = 'read' | 'edit' | 'execute' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolLocation {
  path: string;
  line?: number | null;
}

export interface ToolDiff {
  path: string;
  new_text?: string | null;
  old_text?: string | null;
}

export interface ToolActivity {
  session_id: string;
  agent_id: string;
  agent_kind: string;
  tool_call_id: string;
  kind: ToolKind;
  title: string | null;
  status: ToolStatus;
  locations: ToolLocation[];
  diffs: ToolDiff[];
  approval_tool_call_hash: string | null;
  raw_input_hash: string | null;
  raw_input_redacted: unknown;
  raw_output_redacted: string | null;
  approved_by_approval_id: string | null;
  ts: string;
  outputTruncated: boolean;
  outputRedacted: boolean;
  seq: number;
}

export interface AcpJobLog {
  session_id: string;
  tool_call_id: string;
  agent_id: string;
  command: string | null;
  output: string | null;
  status: ToolStatus;
  approved_by_approval_id: string | null;
  source_event_type?: string;
  truncated: boolean;
  redacted: boolean;
  ts: string;
  seq: number;
}

export interface InlineReviewDiff {
  session_id: string;
  tool_call_id: string;
  status: ToolStatus;
  locations: ToolLocation[];
  diffs: ToolDiff[];
  approved_by_approval_id: string | null;
  source_event_type?: string;
  ts: string;
  seq: number;
}

// ── Caps ───────────────────────────────────────────────────────────────────

const ACTIVITY_CAP = 500;
const LOG_CAP = 500;
const DIFF_CAP = 300;

// Evicts entries from map+order together so the backing Map never retains
// more entries than cap. Without this, selectors only see the capped order
// but Maps grow without bound on long autonomous sessions.
export function capMapByOrder<T>(
  map: Map<string, T>,
  order: string[],
  cap: number,
): { map: Map<string, T>; order: string[] } {
  if (order.length <= cap) return { map, order };
  const nextOrder = order.slice(order.length - cap);
  const nextMap = new Map<string, T>();
  for (const key of nextOrder) {
    const v = map.get(key);
    if (v !== undefined) nextMap.set(key, v);
  }
  // Return new Map only if we actually dropped entries
  if (nextMap.size === map.size) return { map, order: nextOrder };
  return { map: nextMap, order: nextOrder };
}

// ── Key helpers ────────────────────────────────────────────────────────────

export function actKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\x00${toolCallId}`;
}

// ── Store ──────────────────────────────────────────────────────────────────

export interface Diagnostics {
  observed: number;
  updated: number;
  failed: number;
  invalidPayload: number;
  redactedOutput: number;
  truncatedOutput: number;
  approvalCorrelated: number;
  observedOnly: number;
}

const zeroDiag = (): Diagnostics => ({
  observed: 0,
  updated: 0,
  failed: 0,
  invalidPayload: 0,
  redactedOutput: 0,
  truncatedOutput: 0,
  approvalCorrelated: 0,
  observedOnly: 0,
});

interface ToolActivitySlice {
  activities: Map<string, ToolActivity>;
  activityOrder: string[];
  acpLogs: Map<string, AcpJobLog>;
  acpLogOrder: string[];
  inlineDiffs: Map<string, InlineReviewDiff>;
  inlineDiffOrder: string[];
  diagnostics: Diagnostics;

  applyToolObserved(a: ToolActivity): void;
  applyToolUpdated(a: ToolActivity): void;
  applyToolFailed(a: ToolActivity): void;
  applyAcpJobLog(log: AcpJobLog): void;
  applyInlineDiff(diff: InlineReviewDiff): void;
  recordInvalidPayload(): void;
  clearSession(sessionId: string): void;
  clear(): void;
}

let _seq = 0;
export function nextSeq(): number {
  return ++_seq;
}


export const useToolActivity = create<ToolActivitySlice>((set) => ({
  activities: new Map(),
  activityOrder: [],
  acpLogs: new Map(),
  acpLogOrder: [],
  inlineDiffs: new Map(),
  inlineDiffOrder: [],
  diagnostics: zeroDiag(),

  applyToolObserved(a) {
    set((s) => {
      const key = actKey(a.session_id, a.tool_call_id);
      const baseMap = new Map(s.activities);
      const baseOrder = baseMap.has(key) ? s.activityOrder : [...s.activityOrder, key];
      baseMap.set(key, a);
      const { map: activities, order: activityOrder } = capMapByOrder(baseMap, baseOrder, ACTIVITY_CAP);
      return {
        activities,
        activityOrder,
        diagnostics: {
          ...s.diagnostics,
          observed: s.diagnostics.observed + 1,
          approvalCorrelated: s.diagnostics.approvalCorrelated + (a.approved_by_approval_id ? 1 : 0),
          observedOnly: s.diagnostics.observedOnly + (a.approved_by_approval_id ? 0 : 1),
        },
      };
    });
  },

  applyToolUpdated(a) {
    set((s) => {
      const key = actKey(a.session_id, a.tool_call_id);
      const baseMap = new Map(s.activities);
      const baseOrder = baseMap.has(key) ? s.activityOrder : [...s.activityOrder, key];
      baseMap.set(key, a);
      const { map: activities, order: activityOrder } = capMapByOrder(baseMap, baseOrder, ACTIVITY_CAP);
      return {
        activities,
        activityOrder,
        diagnostics: {
          ...s.diagnostics,
          updated: s.diagnostics.updated + 1,
          redactedOutput: s.diagnostics.redactedOutput + (a.outputRedacted ? 1 : 0),
          truncatedOutput: s.diagnostics.truncatedOutput + (a.outputTruncated ? 1 : 0),
        },
      };
    });
  },

  applyToolFailed(a) {
    set((s) => {
      const key = actKey(a.session_id, a.tool_call_id);
      const baseMap = new Map(s.activities);
      const baseOrder = baseMap.has(key) ? s.activityOrder : [...s.activityOrder, key];
      baseMap.set(key, a);
      const { map: activities, order: activityOrder } = capMapByOrder(baseMap, baseOrder, ACTIVITY_CAP);
      return {
        activities,
        activityOrder,
        diagnostics: { ...s.diagnostics, failed: s.diagnostics.failed + 1 },
      };
    });
  },

  applyAcpJobLog(log) {
    set((s) => {
      const key = actKey(log.session_id, log.tool_call_id);
      const baseMap = new Map(s.acpLogs);
      const baseOrder = baseMap.has(key) ? s.acpLogOrder : [...s.acpLogOrder, key];
      baseMap.set(key, log);
      const { map: acpLogs, order: acpLogOrder } = capMapByOrder(baseMap, baseOrder, LOG_CAP);
      return {
        acpLogs,
        acpLogOrder,
        diagnostics: {
          ...s.diagnostics,
          redactedOutput: s.diagnostics.redactedOutput + (log.redacted ? 1 : 0),
          truncatedOutput: s.diagnostics.truncatedOutput + (log.truncated ? 1 : 0),
        },
      };
    });
  },

  applyInlineDiff(diff) {
    set((s) => {
      const key = actKey(diff.session_id, diff.tool_call_id);
      const baseMap = new Map(s.inlineDiffs);
      const baseOrder = baseMap.has(key) ? s.inlineDiffOrder : [...s.inlineDiffOrder, key];
      baseMap.set(key, diff);
      const { map: inlineDiffs, order: inlineDiffOrder } = capMapByOrder(baseMap, baseOrder, DIFF_CAP);
      return { inlineDiffs, inlineDiffOrder };
    });
  },

  recordInvalidPayload() {
    set((s) => ({
      diagnostics: { ...s.diagnostics, invalidPayload: s.diagnostics.invalidPayload + 1 },
    }));
  },

  clearSession(sessionId) {
    set((s) => {
      const prefix = `${sessionId}\x00`;
      const activities = new Map(s.activities);
      const acpLogs = new Map(s.acpLogs);
      const inlineDiffs = new Map(s.inlineDiffs);
      for (const k of activities.keys()) if (k.startsWith(prefix)) activities.delete(k);
      for (const k of acpLogs.keys()) if (k.startsWith(prefix)) acpLogs.delete(k);
      for (const k of inlineDiffs.keys()) if (k.startsWith(prefix)) inlineDiffs.delete(k);
      return {
        activities,
        activityOrder: s.activityOrder.filter((k) => !k.startsWith(prefix)),
        acpLogs,
        acpLogOrder: s.acpLogOrder.filter((k) => !k.startsWith(prefix)),
        inlineDiffs,
        inlineDiffOrder: s.inlineDiffOrder.filter((k) => !k.startsWith(prefix)),
      };
    });
  },

  clear() {
    set({
      activities: new Map(),
      activityOrder: [],
      acpLogs: new Map(),
      acpLogOrder: [],
      inlineDiffs: new Map(),
      inlineDiffOrder: [],
      diagnostics: zeroDiag(),
    });
  },
}));

// ── Selectors (call from component hooks, not directly) ───────────────────

export function selectSessionActivities(sessionId: string): ToolActivity[] {
  const s = useToolActivity.getState();
  const prefix = `${sessionId}\x00`;
  return s.activityOrder
    .filter((k) => k.startsWith(prefix))
    .map((k) => s.activities.get(k))
    .filter((x): x is ToolActivity => x != null);
}

export function selectSessionAcpLogs(sessionId: string): AcpJobLog[] {
  const s = useToolActivity.getState();
  const prefix = `${sessionId}\x00`;
  return s.acpLogOrder
    .filter((k) => k.startsWith(prefix))
    .map((k) => s.acpLogs.get(k))
    .filter((x): x is AcpJobLog => x != null);
}

export function selectSessionInlineDiffs(sessionId: string): InlineReviewDiff[] {
  const s = useToolActivity.getState();
  const prefix = `${sessionId}\x00`;
  return s.inlineDiffOrder
    .filter((k) => k.startsWith(prefix))
    .map((k) => s.inlineDiffs.get(k))
    .filter((x): x is InlineReviewDiff => x != null);
}

export function selectHasTaskFailure(sessionId: string): boolean {
  return selectSessionActivities(sessionId).some((a) => a.status === 'failed');
}
