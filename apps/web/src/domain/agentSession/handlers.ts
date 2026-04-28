import {
  useAgentSession,
  type AgentDiff,
  type AgentLocation,
  type AgentPlanEntry,
  type AgentToolKind,
  type AgentToolStatus,
  type PlanStatus,
} from '../../stores/agentSession';
import type { TransportHandle } from '../../transport';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function asToolKind(raw: unknown): AgentToolKind {
  if (raw === 'read' || raw === 'edit' || raw === 'execute') return raw;
  return 'other';
}

function asStatus(raw: unknown): AgentToolStatus {
  if (raw === 'pending' || raw === 'in_progress' || raw === 'completed' || raw === 'failed') return raw;
  return 'pending';
}

function asPlanStatus(raw: unknown): PlanStatus {
  if (
    raw === 'pending' ||
    raw === 'in_progress' ||
    raw === 'completed' ||
    raw === 'failed' ||
    raw === 'cancelled'
  ) {
    return raw;
  }
  if (raw === 'done') return 'completed';
  if (raw === 'running') return 'in_progress';
  return 'unknown';
}

function asLocations(raw: unknown): AgentLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .filter((x) => typeof x.path === 'string')
    .map((x) => ({
      path: x.path as string,
      line: typeof x.line === 'number' ? x.line : null,
    }));
}

function asDiffs(raw: unknown): AgentDiff[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .filter((x) => typeof x.path === 'string')
    .map((x) => ({
      path: x.path as string,
      old_text: typeof x.old_text === 'string' ? x.old_text : null,
      new_text: typeof x.new_text === 'string' ? x.new_text : null,
    }));
}

function asPlanEntries(raw: unknown): AgentPlanEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .map((x, idx) => ({
      id: asString(x.id) ?? asString(x.plan_id) ?? `plan-${idx + 1}`,
      title: asString(x.title) ?? asString(x.text) ?? asString(x.content) ?? `Step ${idx + 1}`,
      status: asPlanStatus(x.status),
    }));
}

export function registerAgentSessionHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];
  const store = useAgentSession.getState;

  offs.push(
    transport.on('transcript.delta', (ev) => {
      const p = asRecord(ev.payload);
      const delta = asString(p.delta);
      if (!delta || p.kind === 'thought') return;
      store().appendAssistantDelta(ev.session_id, delta, ev.ts);
    }),
  );

  offs.push(
    transport.on('transcript.thought_delta', (ev) => {
      const p = asRecord(ev.payload);
      const delta = asString(p.delta) ?? asString(p.text);
      if (!delta) return;
      store().appendThoughtDelta(ev.session_id, delta, ev.ts);
    }),
  );

  function handleToolCall(eventType: 'tool.call.created' | 'tool.call.updated') {
    return transport.on(eventType, (ev) => {
      const p = asRecord(ev.payload);
      const toolCallId = asString(p.tool_call_id);
      if (!toolCallId) return;
      store().upsertToolCall({
        sessionId: ev.session_id,
        toolCallId,
        kind: asToolKind(p.kind),
        title: asString(p.title),
        status: asStatus(p.status),
        locations: asLocations(p.locations),
        agentId: asString(p.agent_id),
        agentKind: asString(p.agent_kind),
        approvedByApprovalId: asString(p.approved_by_approval_id),
        updatedAt: typeof p.ts === 'string' ? p.ts : ev.ts,
      });
    });
  }

  offs.push(handleToolCall('tool.call.created'));
  offs.push(handleToolCall('tool.call.updated'));

  offs.push(
    transport.on('tool.diff.updated', (ev) => {
      const p = asRecord(ev.payload);
      const toolCallId = asString(p.tool_call_id);
      if (!toolCallId) return;
      store().upsertDiff({
        sessionId: ev.session_id,
        toolCallId,
        status: asStatus(p.status),
        locations: asLocations(p.locations),
        diffs: asDiffs(p.diffs),
        approvedByApprovalId: asString(p.approved_by_approval_id),
        updatedAt: ev.ts,
      });
    }),
  );

  offs.push(
    transport.on('tool.terminal.updated', (ev) => {
      const p = asRecord(ev.payload);
      const toolCallId = asString(p.tool_call_id);
      if (!toolCallId) return;
      store().upsertTerminal({
        sessionId: ev.session_id,
        toolCallId,
        status: asStatus(p.status),
        rawInputRedacted: p.raw_input_redacted ?? null,
        rawOutputRedacted: asString(p.raw_output_redacted),
        approvedByApprovalId: asString(p.approved_by_approval_id),
        agentId: asString(p.agent_id),
        agentKind: asString(p.agent_kind),
        updatedAt: ev.ts,
      });
    }),
  );

  offs.push(
    transport.on('plan.updated', (ev) => {
      const p = asRecord(ev.payload);
      store().updatePlan({
        sessionId: ev.session_id,
        entries: asPlanEntries(p.entries),
        updatedAt: ev.ts,
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
