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

  return () => offs.forEach((off) => off());
}
