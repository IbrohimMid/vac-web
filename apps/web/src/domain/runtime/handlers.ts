// Wire runtime.job.* events → runtime store.

import { useRuntime, type JobStatus } from '../../stores/runtime';
import type { TransportHandle } from '../../transport';

function asStatus(raw: string | undefined): JobStatus {
  if (
    raw === 'pending' ||
    raw === 'running' ||
    raw === 'succeeded' ||
    raw === 'failed' ||
    raw === 'cancelled'
  )
    return raw;
  return 'pending';
}

interface JobUpsertPayload {
  job_id: string;
  kind: string;
  label?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
}

interface LogPayload {
  job_id: string;
  ts?: string;
  stream?: string;
  text: string;
}

interface BridgeRuntimeLogPayload {
  tool_call_id?: unknown;
  status?: unknown;
  command?: unknown;
  output?: unknown;
  approved_by_approval_id?: unknown;
  agent_id?: unknown;
  ts?: unknown;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function preview(raw: string): string {
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

function outputFlags(output: string | null): { outputTruncated: boolean; outputRedacted: boolean } {
  return {
    outputTruncated: output?.includes('…[truncated by VAC bridge]') ?? false,
    outputRedacted: output?.includes('<REDACTED-SECRET>') ?? false,
  };
}

function bridgeStatus(raw: unknown): JobStatus {
  if (raw === 'pending') return 'pending';
  if (raw === 'in_progress' || raw === 'running') return 'running';
  if (raw === 'completed') return 'succeeded';
  if (raw === 'failed') return 'failed';
  if (raw === 'cancelled') return 'cancelled';
  return 'pending';
}

export function registerRuntimeHandlers(transport: TransportHandle): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    transport.on('runtime.job.upserted', (ev) => {
      const p = ev.payload as JobUpsertPayload | null;
      if (!p?.job_id) return;
      useRuntime.getState().upsert({
        id: p.job_id,
        kind: p.kind,
        label: p.label ?? p.kind,
        status: asStatus(p.status),
        startedAt: p.started_at ?? new Date().toISOString(),
        ...(p.finished_at !== undefined ? { finishedAt: p.finished_at } : {}),
      });
    }),
  );

  offs.push(
    transport.on('runtime.job.log', (ev) => {
      const p = ev.payload as LogPayload | null;
      if (!p?.job_id || typeof p.text !== 'string') return;
      useRuntime.getState().appendLog(p.job_id, {
        ts: p.ts ?? new Date().toISOString(),
        stream: p.stream === 'stderr' ? 'stderr' : 'stdout',
        text: p.text,
      });
    }),
  );

  offs.push(
    transport.on('runtime.job_log', (ev) => {
      const p = asRecord(ev.payload) as BridgeRuntimeLogPayload;
      const toolCallId = asString(p.tool_call_id) ?? '';
      if (!toolCallId) return;
      const command = asString(p.command);
      const output = asString(p.output);
      const flags = outputFlags(output);
      const label = command ? preview(command) : 'Runtime job';
      useRuntime.getState().upsert({
        id: toolCallId,
        kind: 'execute',
        label,
        status: bridgeStatus(p.status),
        startedAt: typeof p.ts === 'string' ? p.ts : ev.ts,
        ...(bridgeStatus(p.status) === 'succeeded' || bridgeStatus(p.status) === 'failed'
          ? { finishedAt: typeof p.ts === 'string' ? p.ts : ev.ts }
          : {}),
        toolCallId,
        approvedByApprovalId: asString(p.approved_by_approval_id),
        sourceEventType: 'runtime.job_log',
        commandPreview: command ? preview(command) : null,
        outputPreview: output ? preview(output) : null,
        outputTruncated: flags.outputTruncated,
        outputRedacted: flags.outputRedacted,
      });
      const logText = output ?? command ?? '';
      if (logText) {
        useRuntime.getState().appendLog(toolCallId, {
          ts: typeof p.ts === 'string' ? p.ts : ev.ts,
          stream: 'stdout',
          text: logText,
        });
      }
    }),
  );

  return () => offs.forEach((off) => off());
}
