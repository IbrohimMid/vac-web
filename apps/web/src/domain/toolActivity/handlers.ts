// X.5c.2 — wire tool.{observed,updated,failed} / review.changeset_updated
// / runtime.job_log events from the bridge into the toolActivity store.
//
// Observe-only: handlers record but never send commands back to the bridge.

import {
  useToolActivity,
  nextSeq,
  type ToolKind,
  type ToolStatus,
  type ToolLocation,
  type ToolDiff,
} from '../../stores/toolActivity';
import type { TransportHandle } from '../../transport';

// ── Normalizers ────────────────────────────────────────────────────────────

function asToolKind(raw: unknown): ToolKind {
  if (raw === 'read' || raw === 'edit' || raw === 'execute') return raw;
  return 'other';
}

function asToolStatus(raw: unknown): ToolStatus {
  if (raw === 'pending' || raw === 'in_progress' || raw === 'completed' || raw === 'failed')
    return raw;
  return 'pending';
}

function asLocations(raw: unknown): ToolLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .filter((x) => typeof x['path'] === 'string')
    .map((x) => ({
      path: x['path'] as string,
      line: typeof x['line'] === 'number' ? x['line'] : null,
    }));
}

function asDiffs(raw: unknown): ToolDiff[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
    .filter((x) => typeof x['path'] === 'string')
    .map((x) => ({
      path: x['path'] as string,
      new_text: typeof x['new_text'] === 'string' ? x['new_text'] : null,
      old_text: typeof x['old_text'] === 'string' ? x['old_text'] : null,
    }));
}

function asNullableString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

function outputFlags(output: string | null): { outputTruncated: boolean; outputRedacted: boolean } {
  return {
    outputTruncated: output?.includes('…[truncated by VAC bridge]') ?? false,
    outputRedacted: output?.includes('<REDACTED-SECRET>') ?? false,
  };
}

// ── Payload interfaces ─────────────────────────────────────────────────────

interface ToolActivityPayload {
  session_id?: unknown;
  agent_id?: unknown;
  agent_kind?: unknown;
  tool_call_id?: unknown;
  kind?: unknown;
  title?: unknown;
  status?: unknown;
  locations?: unknown;
  diffs?: unknown;
  approval_tool_call_hash?: unknown;
  raw_input_hash?: unknown;
  raw_input_redacted?: unknown;
  raw_output_redacted?: unknown;
  approved_by_approval_id?: unknown;
  ts?: unknown;
}

interface ReviewChangesetPayload {
  tool_call_id?: unknown;
  status?: unknown;
  locations?: unknown;
  diffs?: unknown;
  approved_by_approval_id?: unknown;
  ts?: unknown;
}

interface RuntimeJobLogPayload {
  tool_call_id?: unknown;
  status?: unknown;
  command?: unknown;
  output?: unknown;
  approved_by_approval_id?: unknown;
  agent_id?: unknown;
  ts?: unknown;
}

// ── Handler registration ───────────────────────────────────────────────────

export function registerToolActivityHandlers(transport: TransportHandle): () => void {
  const store = useToolActivity.getState;
  const offs: Array<() => void> = [];

  function handleToolActivity(evType: string) {
    return offs.push(
      transport.on(evType, (ev) => {
        const p = ev.payload as ToolActivityPayload | null;
        if (!p || typeof p.tool_call_id !== 'string' || !p.tool_call_id) {
          store().recordInvalidPayload();
          return;
        }
        const sessionId = typeof p.session_id === 'string' ? p.session_id : ev.session_id;
        if (!sessionId) {
          store().recordInvalidPayload();
          return;
        }
        const raw = asNullableString(p.raw_output_redacted);
        const status = asToolStatus(p.status);
        const activity = {
          session_id: sessionId,
          agent_id: typeof p.agent_id === 'string' ? p.agent_id : '',
          agent_kind: typeof p.agent_kind === 'string' ? p.agent_kind : 'acp',
          tool_call_id: p.tool_call_id,
          kind: asToolKind(p.kind),
          title: asNullableString(p.title),
          status,
          locations: asLocations(p.locations),
          diffs: asDiffs(p.diffs),
          approval_tool_call_hash: asNullableString(p.approval_tool_call_hash),
          raw_input_hash: asNullableString(p.raw_input_hash),
          raw_input_redacted: p.raw_input_redacted ?? null,
          raw_output_redacted: raw,
          approved_by_approval_id: asNullableString(p.approved_by_approval_id),
          ts: typeof p.ts === 'string' ? p.ts : ev.ts,
          ...outputFlags(raw),
          seq: nextSeq(),
        };
        if (evType === 'tool.observed') {
          store().applyToolObserved(activity);
        } else if (evType === 'tool.failed') {
          store().applyToolFailed(activity);
        } else {
          store().applyToolUpdated(activity);
        }
      }),
    );
  }

  handleToolActivity('tool.observed');
  handleToolActivity('tool.updated');
  handleToolActivity('tool.failed');

  offs.push(
    transport.on('review.changeset_updated', (ev) => {
      const p = ev.payload as ReviewChangesetPayload | null;
      if (!p || typeof p.tool_call_id !== 'string' || !p.tool_call_id) {
        store().recordInvalidPayload();
        return;
      }
      const diffs = asDiffs(p.diffs);
      if (diffs.length === 0 && asLocations(p.locations).length === 0) return;
      store().applyInlineDiff({
        session_id: ev.session_id,
        tool_call_id: p.tool_call_id,
        status: asToolStatus(p.status),
        locations: asLocations(p.locations),
        diffs,
        approved_by_approval_id: asNullableString(p.approved_by_approval_id),
        source_event_type: 'review.changeset_updated',
        ts: typeof p.ts === 'string' ? p.ts : ev.ts,
        seq: nextSeq(),
      });
    }),
  );

  offs.push(
    transport.on('runtime.job_log', (ev) => {
      const p = ev.payload as RuntimeJobLogPayload | null;
      if (!p || typeof p.tool_call_id !== 'string' || !p.tool_call_id) {
        store().recordInvalidPayload();
        return;
      }
      const output = asNullableString(p.output);
      const flags = outputFlags(output);
      store().applyAcpJobLog({
        session_id: ev.session_id,
        tool_call_id: p.tool_call_id,
        agent_id: asNullableString(p.agent_id) ?? '',
        command: asNullableString(p.command),
        output,
        status: asToolStatus(p.status),
        approved_by_approval_id: asNullableString(p.approved_by_approval_id),
        source_event_type: 'runtime.job_log',
        truncated: flags.outputTruncated,
        redacted: flags.outputRedacted,
        ts: typeof p.ts === 'string' ? p.ts : ev.ts,
        seq: nextSeq(),
      });
    }),
  );

  return () => offs.forEach((off) => off());
}
